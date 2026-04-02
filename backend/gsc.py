import json
import csv
import io
import logging
import re
from datetime import datetime, timedelta
from urllib.parse import urlparse

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from config import settings
from database import get_connection

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def normalize_gsc_url(url: str) -> str:
    """Normalize a GSC URL to match crawler normalization."""
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme}://{parsed.netloc.lower()}{path.lower()}"


def get_oauth_flow() -> Flow:
    client_config = {
        "web": {
            "client_id": settings.gsc_client_id,
            "client_secret": settings.gsc_client_secret,
            "redirect_uris": [settings.gsc_redirect_uri],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SCOPES)
    flow.redirect_uri = settings.gsc_redirect_uri
    return flow


def get_auth_url(project_id: int) -> str:
    flow = get_oauth_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=str(project_id),
    )
    return auth_url


def handle_callback(code: str, project_id: int) -> str:
    flow = get_oauth_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
    }
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO gsc_tokens (project_id, token_json, updated_at) VALUES (?, ?, datetime('now'))",
        (project_id, json.dumps(token_data))
    )
    conn.commit()
    conn.close()
    return "ok"


def get_credentials(project_id: int) -> Credentials | None:
    conn = get_connection()
    row = conn.execute("SELECT token_json FROM gsc_tokens WHERE project_id=?", (project_id,)).fetchone()
    conn.close()
    if not row:
        return None
    data = json.loads(row["token_json"])
    return Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=data.get("scopes"),
    )


def fetch_gsc_data(project_id: int, domain: str, start_date: str | None = None, end_date: str | None = None):
    creds = get_credentials(project_id)
    if not creds:
        raise ValueError("GSC not connected for this project")

    service = build("searchconsole", "v1", credentials=creds)

    if not end_date:
        end_date = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    if not start_date:
        start_date = (datetime.now() - timedelta(days=93)).strftime("%Y-%m-%d")

    site_url = f"sc-domain:{domain}"
    conn = get_connection()

    conn.execute(
        "DELETE FROM gsc_data WHERE project_id=? AND date >= ? AND date <= ?",
        (project_id, start_date, end_date)
    )
    conn.commit()

    start_row = 0
    row_limit = 25000

    while True:
        body = {
            "startDate": start_date,
            "endDate": end_date,
            "dimensions": ["page", "query", "date"],
            "rowLimit": row_limit,
            "startRow": start_row,
        }

        response = service.searchanalytics().query(siteUrl=site_url, body=body).execute()
        rows = response.get("rows", [])

        if not rows:
            break

        for row in rows:
            keys = row["keys"]
            conn.execute(
                """INSERT INTO gsc_data (project_id, page_url, query, clicks, impressions, ctr, position, date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (project_id, normalize_gsc_url(keys[0]), keys[1],
                 row.get("clicks", 0), row.get("impressions", 0),
                 row.get("ctr", 0.0), row.get("position", 0.0),
                 keys[2])
            )

        conn.commit()
        start_row += len(rows)

        if len(rows) < row_limit:
            break

    conn.close()


def _parse_ctr(value: str) -> float:
    """Parse CTR from various formats: '7.5%', '0.075', etc."""
    s = str(value).strip().replace(",", ".")
    if "%" in s:
        try:
            return float(s.replace("%", "")) / 100
        except ValueError:
            return 0.0
    try:
        v = float(s)
        return v if v <= 1 else v / 100
    except ValueError:
        return 0.0


def _detect_csv_format(headers: list[str]) -> str:
    """Detect CSV format: 'pages_only' or 'pages_queries'."""
    lower = [h.lower().strip() for h in headers]
    has_query = any(h in lower for h in ["query", "queries", "top queries", "search query"])
    if has_query:
        return "pages_queries"
    return "pages_only"


def _find_column(headers: list[str], candidates: list[str]) -> int | None:
    lower = [h.lower().strip() for h in headers]
    for c in candidates:
        if c in lower:
            return lower.index(c)
    return None


def upload_gsc_csv(project_id: int, file_content: str) -> int:
    """Parse and import a GSC CSV. Returns number of rows imported."""
    conn = get_connection()

    # Clear existing data for this project
    conn.execute("DELETE FROM gsc_data WHERE project_id=?", (project_id,))
    conn.commit()

    reader = csv.reader(io.StringIO(file_content))
    headers = next(reader, None)
    if not headers:
        conn.close()
        return 0

    fmt = _detect_csv_format(headers)

    col_page = _find_column(headers, ["page", "pages", "top pages", "url"])
    col_clicks = _find_column(headers, ["clicks", "clics"])
    col_impressions = _find_column(headers, ["impressions"])
    col_ctr = _find_column(headers, ["ctr"])
    col_position = _find_column(headers, ["position", "average position", "position moyenne"])
    col_query = _find_column(headers, ["query", "queries", "top queries", "search query"]) if fmt == "pages_queries" else None

    if col_page is None:
        conn.close()
        return 0

    count = 0
    for row in reader:
        if len(row) <= col_page:
            continue
        page_url = normalize_gsc_url(row[col_page].strip())
        if not page_url:
            continue

        clicks = int(row[col_clicks]) if col_clicks is not None and col_clicks < len(row) and row[col_clicks].strip().replace(",", "").isdigit() else 0
        impressions = int(row[col_impressions]) if col_impressions is not None and col_impressions < len(row) and row[col_impressions].strip().replace(",", "").isdigit() else 0
        ctr = _parse_ctr(row[col_ctr]) if col_ctr is not None and col_ctr < len(row) else 0.0
        position = 0.0
        if col_position is not None and col_position < len(row):
            try:
                position = float(row[col_position].strip().replace(",", "."))
            except ValueError:
                pass
        query = row[col_query].strip() if col_query is not None and col_query < len(row) else ""

        conn.execute(
            """INSERT INTO gsc_data (project_id, page_url, query, clicks, impressions, ctr, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (project_id, page_url, query, clicks, impressions, ctr, position)
        )
        count += 1

    conn.commit()
    conn.close()
    return count
