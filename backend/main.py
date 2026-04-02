import asyncio
import json
import logging
import os

from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from config import settings
from database import init_db, get_connection
from crawler import crawl_site
from embeddings import analyze_project
from gsc import get_auth_url, handle_callback, fetch_gsc_data, upload_gsc_csv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TopicDrift", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


# ---------- Models ----------

class ProjectCreate(BaseModel):
    name: str
    domain: str
    anchor_keywords: list[str] = []


class ProjectUpdate(BaseModel):
    name: str | None = None
    domain: str | None = None
    anchor_keywords: list[str] | None = None


# ---------- Projects ----------

@app.post("/api/projects")
def create_project(data: ProjectCreate):
    conn = get_connection()
    cursor = conn.execute(
        "INSERT INTO projects (name, domain, anchor_keywords) VALUES (?, ?, ?)",
        (data.name, data.domain.strip().lower().replace("https://", "").replace("http://", "").rstrip("/"),
         json.dumps(data.anchor_keywords))
    )
    project_id = cursor.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/projects")
def list_projects():
    conn = get_connection()
    rows = conn.execute("""
        SELECT p.*,
            (SELECT COUNT(*) FROM pages WHERE project_id=p.id) as page_count,
            (SELECT AVG(similarity_score) FROM pages WHERE project_id=p.id AND similarity_score IS NOT NULL) as avg_score
        FROM projects p ORDER BY p.created_at DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    conn = get_connection()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Project not found")
    result = dict(row)
    # Remove binary data from response
    result.pop("anchor_embedding", None)
    stats = conn.execute("""
        SELECT
            COUNT(*) as total_pages,
            AVG(similarity_score) as avg_score
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL
    """, (project_id,)).fetchone()
    result["total_pages"] = stats["total_pages"]
    result["avg_score"] = stats["avg_score"]
    # Check if GSC connected
    gsc_row = conn.execute("SELECT 1 FROM gsc_tokens WHERE project_id=?", (project_id,)).fetchone()
    result["gsc_connected"] = gsc_row is not None
    conn.close()
    return result


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Crawl ----------

def run_crawl(project_id: int, domain: str):
    asyncio.run(crawl_site(
        project_id, domain,
        max_pages=settings.max_crawl_pages,
        max_depth=settings.max_crawl_depth,
        delay=settings.crawl_delay,
    ))


@app.post("/api/projects/{project_id}/crawl")
def start_crawl(project_id: int, background_tasks: BackgroundTasks):
    conn = get_connection()
    row = conn.execute("SELECT domain, status FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Project not found")
    if row["status"] == "crawling":
        raise HTTPException(409, "Crawl already in progress")
    background_tasks.add_task(run_crawl, project_id, row["domain"])
    return {"status": "started"}


@app.get("/api/projects/{project_id}/crawl/status")
def crawl_status(project_id: int):
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM crawl_jobs WHERE project_id=? ORDER BY id DESC LIMIT 1",
        (project_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {"status": "none"}
    return dict(row)


# ---------- Analysis ----------

def run_analysis(project_id: int):
    analyze_project(project_id)


@app.post("/api/projects/{project_id}/analyze")
def start_analysis(project_id: int, background_tasks: BackgroundTasks):
    conn = get_connection()
    row = conn.execute("SELECT status FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Project not found")
    if row["status"] == "analyzing":
        raise HTTPException(409, "Analysis already in progress")
    background_tasks.add_task(run_analysis, project_id)
    return {"status": "started"}


@app.get("/api/projects/{project_id}/results")
def get_results(project_id: int):
    conn = get_connection()
    rows = conn.execute("""
        SELECT url, title, h1, similarity_score, word_count, status_code
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL
        ORDER BY similarity_score ASC
    """, (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/projects/{project_id}/dashboard")
def get_dashboard(project_id: int):
    conn = get_connection()

    # Project info
    project = conn.execute("SELECT id, name, domain, status, anchor_keywords FROM projects WHERE id=?", (project_id,)).fetchone()
    if not project:
        conn.close()
        raise HTTPException(404, "Project not found")

    project_dict = dict(project)
    anchor_keywords = json.loads(project_dict.get("anchor_keywords", "[]"))

    # Page stats
    pages_rows = conn.execute("""
        SELECT url, title, similarity_score, word_count
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL
        ORDER BY similarity_score ASC
    """, (project_id,)).fetchall()

    pages = [dict(r) for r in pages_rows]
    total_pages = len(pages)

    if total_pages == 0:
        conn.close()
        return {
            "project": {"id": project_dict["id"], "name": project_dict["name"],
                        "domain": project_dict["domain"], "status": project_dict["status"]},
            "stats": {"total_pages": 0, "avg_similarity": 0, "median_similarity": 0,
                      "pages_on_topic": 0, "pages_off_topic": 0, "pages_borderline": 0,
                      "dilution_ratio": 0, "dilution_ratio_weighted": 0},
            "distribution": [],
            "pages": [],
            "gsc_available": False,
            "anchor_keywords": anchor_keywords,
        }

    scores = [p["similarity_score"] for p in pages]
    avg_sim = sum(scores) / len(scores)
    sorted_scores = sorted(scores)
    mid = len(sorted_scores) // 2
    median_sim = sorted_scores[mid] if len(sorted_scores) % 2 else (sorted_scores[mid - 1] + sorted_scores[mid]) / 2

    on_topic = sum(1 for s in scores if s >= 0.7)
    off_topic = sum(1 for s in scores if s < 0.5)
    borderline = total_pages - on_topic - off_topic
    dilution_ratio = off_topic / total_pages if total_pages else 0

    # Distribution buckets
    distribution = []
    for i in range(10):
        low = i / 10
        high = (i + 1) / 10
        label = f"{low:.1f}-{high:.1f}"
        count = sum(1 for s in scores if low <= s < high) if i < 9 else sum(1 for s in scores if low <= s <= high)
        distribution.append({"range": label, "count": count})

    # GSC data
    gsc_row = conn.execute("SELECT 1 FROM gsc_data WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
    gsc_available = gsc_row is not None

    # Enrich pages with GSC data
    for page in pages:
        url = page["url"]
        gsc_agg = conn.execute("""
            SELECT SUM(clicks) as total_clicks, SUM(impressions) as total_impressions
            FROM gsc_data WHERE project_id=? AND page_url=?
        """, (project_id, url)).fetchone()

        page["gsc_clicks"] = gsc_agg["total_clicks"] if gsc_agg and gsc_agg["total_clicks"] else 0
        page["gsc_impressions"] = gsc_agg["total_impressions"] if gsc_agg and gsc_agg["total_impressions"] else 0

        top_queries = conn.execute("""
            SELECT query, SUM(clicks) as c FROM gsc_data
            WHERE project_id=? AND page_url=?
            GROUP BY query ORDER BY c DESC LIMIT 3
        """, (project_id, url)).fetchall()
        page["top_queries"] = [q["query"] for q in top_queries]

    # Weighted dilution ratio
    total_traffic = sum(p["gsc_clicks"] for p in pages)
    if total_traffic > 0:
        off_topic_traffic = sum(p["gsc_clicks"] for p in pages if p["similarity_score"] < 0.5)
        dilution_ratio_weighted = off_topic_traffic / total_traffic
    else:
        dilution_ratio_weighted = dilution_ratio

    conn.close()

    return {
        "project": {"id": project_dict["id"], "name": project_dict["name"],
                     "domain": project_dict["domain"], "status": project_dict["status"]},
        "stats": {
            "total_pages": total_pages,
            "avg_similarity": round(avg_sim, 3),
            "median_similarity": round(median_sim, 3),
            "pages_on_topic": on_topic,
            "pages_off_topic": off_topic,
            "pages_borderline": borderline,
            "dilution_ratio": round(dilution_ratio, 3),
            "dilution_ratio_weighted": round(dilution_ratio_weighted, 3),
        },
        "distribution": distribution,
        "pages": pages,
        "gsc_available": gsc_available,
        "anchor_keywords": anchor_keywords,
    }


# ---------- GSC ----------

@app.get("/api/gsc/auth-url")
def gsc_auth_url(project_id: int = Query(...)):
    if not settings.gsc_client_id:
        raise HTTPException(400, "GSC credentials not configured")
    url = get_auth_url(project_id)
    return {"url": url}


@app.get("/api/gsc/callback")
def gsc_callback(code: str = Query(...), state: str = Query(...)):
    project_id = int(state)
    handle_callback(code, project_id)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"/?project={project_id}&gsc=connected")


@app.post("/api/projects/{project_id}/gsc/fetch")
def gsc_fetch(project_id: int, start_date: str | None = None, end_date: str | None = None):
    conn = get_connection()
    project = conn.execute("SELECT domain FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    if not project:
        raise HTTPException(404, "Project not found")
    try:
        fetch_gsc_data(project_id, project["domain"], start_date, end_date)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "ok"}


@app.post("/api/projects/{project_id}/gsc/upload")
async def gsc_upload(project_id: int, file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8")
    upload_gsc_csv(project_id, text)
    return {"status": "ok"}


@app.get("/api/projects/{project_id}/gsc/data")
def gsc_data(project_id: int):
    conn = get_connection()
    rows = conn.execute("""
        SELECT page_url, query, SUM(clicks) as clicks, SUM(impressions) as impressions,
               AVG(ctr) as ctr, AVG(position) as position
        FROM gsc_data WHERE project_id=?
        GROUP BY page_url, query
        ORDER BY clicks DESC
        LIMIT 500
    """, (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------- Frontend static files ----------

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
