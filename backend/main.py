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
from suggest import suggest_keywords

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
    lang_filter: str | None = None
    threshold_off_topic: float = 0.5
    threshold_on_topic: float = 0.7


class ProjectPatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    anchor_keywords: list[str] | None = None
    lang_filter: str | None = None
    threshold_off_topic: float | None = None
    threshold_on_topic: float | None = None


class SuggestRequest(BaseModel):
    domain: str


# ---------- Projects ----------

@app.post("/api/projects")
def create_project(data: ProjectCreate):
    domain = data.domain.strip().lower().replace("https://", "").replace("http://", "").rstrip("/")
    conn = get_connection()
    cursor = conn.execute(
        """INSERT INTO projects (name, domain, anchor_keywords, lang_filter, threshold_off_topic, threshold_on_topic)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (data.name, domain, json.dumps(data.anchor_keywords),
         data.lang_filter, data.threshold_off_topic, data.threshold_on_topic)
    )
    project_id = cursor.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    result = dict(row)
    result.pop("anchor_embedding", None)
    return result


@app.get("/api/projects")
def list_projects():
    conn = get_connection()
    rows = conn.execute("""
        SELECT p.*,
            (SELECT COUNT(*) FROM pages WHERE project_id=p.id) as page_count,
            (SELECT AVG(similarity_score) FROM pages WHERE project_id=p.id AND similarity_score IS NOT NULL AND page_type != 'structural') as avg_score,
            (SELECT COUNT(*) FROM pages WHERE project_id=p.id AND similarity_score IS NOT NULL AND page_type != 'structural' AND similarity_score < p.threshold_off_topic) as off_topic_count,
            (SELECT COUNT(*) FROM pages WHERE project_id=p.id AND similarity_score IS NOT NULL AND page_type != 'structural') as analyzed_count
        FROM projects p ORDER BY p.created_at DESC
    """).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        d.pop("anchor_embedding", None)
        d["dilution_ratio"] = round(d["off_topic_count"] / d["analyzed_count"], 3) if d["analyzed_count"] else 0
        results.append(d)
    return results


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    conn = get_connection()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Project not found")
    result = dict(row)
    result.pop("anchor_embedding", None)
    stats = conn.execute("""
        SELECT COUNT(*) as total_pages,
               AVG(similarity_score) as avg_score
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL AND page_type != 'structural'
    """, (project_id,)).fetchone()
    result["total_pages"] = stats["total_pages"]
    result["avg_score"] = stats["avg_score"]
    gsc_row = conn.execute("SELECT 1 FROM gsc_tokens WHERE project_id=?", (project_id,)).fetchone()
    gsc_data_row = conn.execute("SELECT COUNT(*) as c FROM gsc_data WHERE project_id=?", (project_id,)).fetchone()
    result["gsc_connected"] = gsc_row is not None
    result["gsc_rows"] = gsc_data_row["c"]
    conn.close()
    return result


@app.patch("/api/projects/{project_id}")
def patch_project(project_id: int, data: ProjectPatch):
    conn = get_connection()
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Project not found")

    updates = []
    params = []
    if data.name is not None:
        updates.append("name=?")
        params.append(data.name)
    if data.domain is not None:
        updates.append("domain=?")
        params.append(data.domain.strip().lower().replace("https://", "").replace("http://", "").rstrip("/"))
    if data.anchor_keywords is not None:
        updates.append("anchor_keywords=?")
        params.append(json.dumps(data.anchor_keywords))
    if data.lang_filter is not None:
        updates.append("lang_filter=?")
        params.append(data.lang_filter or None)
    if data.threshold_off_topic is not None:
        updates.append("threshold_off_topic=?")
        params.append(data.threshold_off_topic)
    if data.threshold_on_topic is not None:
        updates.append("threshold_on_topic=?")
        params.append(data.threshold_on_topic)

    if updates:
        updates.append("updated_at=datetime('now')")
        params.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()

    result = dict(conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
    result.pop("anchor_embedding", None)
    conn.close()
    return result


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---------- Keyword Suggestions ----------

@app.post("/api/projects/suggest-keywords")
async def suggest_kw(data: SuggestRequest):
    domain = data.domain.strip().lower().replace("https://", "").replace("http://", "").rstrip("/")
    keywords = await suggest_keywords(domain)
    return {"keywords": keywords}


# ---------- Crawl ----------

def run_crawl(project_id: int, domain: str, lang_filter: str | None):
    asyncio.run(crawl_site(
        project_id, domain,
        max_pages=settings.max_crawl_pages,
        max_depth=settings.max_crawl_depth,
        delay=settings.crawl_delay,
        lang_filter=lang_filter,
    ))


@app.post("/api/projects/{project_id}/crawl")
def start_crawl(project_id: int, background_tasks: BackgroundTasks):
    conn = get_connection()
    row = conn.execute("SELECT domain, status, lang_filter FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Project not found")
    if row["status"] == "crawling":
        raise HTTPException(409, "Crawl already in progress")
    background_tasks.add_task(run_crawl, project_id, row["domain"], row["lang_filter"])
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
        SELECT id, url, path, title, h1, similarity_score, word_count, page_type, status_code
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL
        ORDER BY similarity_score ASC
    """, (project_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/projects/{project_id}/results/{page_id}")
def get_page_detail(project_id: int, page_id: int):
    conn = get_connection()
    page = conn.execute("""
        SELECT id, url, path, title, h1, meta_description, content_text,
               word_count, page_type, similarity_score
        FROM pages WHERE id=? AND project_id=?
    """, (page_id, project_id)).fetchone()
    if not page:
        conn.close()
        raise HTTPException(404, "Page not found")

    result = dict(page)
    # Content preview: first 500 chars
    if result.get("content_text"):
        result["content_preview"] = result["content_text"][:500]
    else:
        result["content_preview"] = ""
    del result["content_text"]

    # GSC queries for this page
    gsc_queries = conn.execute("""
        SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
               AVG(position) as position, AVG(ctr) as ctr
        FROM gsc_data WHERE project_id=? AND page_url=? AND query != ''
        GROUP BY query ORDER BY clicks DESC LIMIT 10
    """, (project_id, result["url"])).fetchall()
    result["gsc_queries"] = [dict(q) for q in gsc_queries]

    conn.close()
    return result


@app.get("/api/projects/{project_id}/dashboard")
def get_dashboard(project_id: int):
    conn = get_connection()

    project = conn.execute(
        "SELECT id, name, domain, status, anchor_keywords, lang_filter, threshold_off_topic, threshold_on_topic FROM projects WHERE id=?",
        (project_id,)
    ).fetchone()
    if not project:
        conn.close()
        raise HTTPException(404, "Project not found")

    project_dict = dict(project)
    anchor_keywords = json.loads(project_dict.get("anchor_keywords", "[]"))
    t_off = project_dict["threshold_off_topic"]
    t_on = project_dict["threshold_on_topic"]

    # All pages with scores
    all_pages = conn.execute("""
        SELECT id, url, path, title, similarity_score, word_count, page_type
        FROM pages WHERE project_id=? AND similarity_score IS NOT NULL
        ORDER BY similarity_score ASC
    """, (project_id,)).fetchall()

    all_pages = [dict(r) for r in all_pages]
    total_all = len(all_pages)
    structural_count = sum(1 for p in all_pages if p["page_type"] == "structural")
    analyzed_pages = [p for p in all_pages if p["page_type"] != "structural"]
    total_analyzed = len(analyzed_pages)

    empty_response = {
        "project": project_dict,
        "stats": {"total_pages": total_all, "total_pages_analyzed": 0, "structural_pages": structural_count,
                  "avg_similarity": 0, "median_similarity": 0, "pages_on_topic": 0,
                  "pages_off_topic": 0, "pages_borderline": 0, "dilution_ratio": 0, "dilution_ratio_weighted": 0},
        "distribution": [], "pages": [], "cluster_bubbles": [],
        "gsc_available": False, "anchor_keywords": anchor_keywords,
    }

    if total_analyzed == 0:
        conn.close()
        return empty_response

    scores = [p["similarity_score"] for p in analyzed_pages]
    avg_sim = sum(scores) / len(scores)
    sorted_scores = sorted(scores)
    mid = len(sorted_scores) // 2
    median_sim = sorted_scores[mid] if len(sorted_scores) % 2 else (sorted_scores[mid - 1] + sorted_scores[mid]) / 2

    on_topic = sum(1 for s in scores if s >= t_on)
    off_topic = sum(1 for s in scores if s < t_off)
    borderline = total_analyzed - on_topic - off_topic
    dilution_ratio = off_topic / total_analyzed if total_analyzed else 0

    # Distribution buckets
    distribution = []
    for i in range(10):
        low = i / 10
        high = (i + 1) / 10
        label = f"{low:.1f}-{high:.1f}"
        count = sum(1 for s in scores if low <= s < high) if i < 9 else sum(1 for s in scores if low <= s <= high)
        distribution.append({"range": label, "count": count})

    # GSC availability
    gsc_row = conn.execute("SELECT 1 FROM gsc_data WHERE project_id=? LIMIT 1", (project_id,)).fetchone()
    gsc_available = gsc_row is not None

    # Enrich pages with GSC data
    for page in all_pages:
        url = page["url"]
        page["is_structural"] = page["page_type"] == "structural"

        gsc_agg = conn.execute("""
            SELECT SUM(clicks) as total_clicks, SUM(impressions) as total_impressions,
                   AVG(position) as avg_position, AVG(ctr) as avg_ctr
            FROM gsc_data WHERE project_id=? AND page_url=?
        """, (project_id, url)).fetchone()

        page["gsc_clicks"] = gsc_agg["total_clicks"] or 0 if gsc_agg else 0
        page["gsc_impressions"] = gsc_agg["total_impressions"] or 0 if gsc_agg else 0
        page["gsc_position"] = round(gsc_agg["avg_position"], 1) if gsc_agg and gsc_agg["avg_position"] else None
        page["gsc_ctr"] = round(gsc_agg["avg_ctr"], 4) if gsc_agg and gsc_agg["avg_ctr"] else None

        top_queries = conn.execute("""
            SELECT query, SUM(clicks) as c FROM gsc_data
            WHERE project_id=? AND page_url=? AND query != ''
            GROUP BY query ORDER BY c DESC LIMIT 3
        """, (project_id, url)).fetchall()
        page["top_queries"] = [q["query"] for q in top_queries]

    # Weighted dilution ratio
    content_pages = [p for p in all_pages if not p["is_structural"]]
    total_traffic = sum(p["gsc_clicks"] for p in content_pages)
    if total_traffic > 0:
        off_topic_traffic = sum(p["gsc_clicks"] for p in content_pages if p["similarity_score"] < t_off)
        dilution_ratio_weighted = off_topic_traffic / total_traffic
    else:
        dilution_ratio_weighted = dilution_ratio

    # Cluster bubbles
    cluster_bubbles = []
    for i in range(10):
        low = i / 10
        high = (i + 1) / 10
        cluster_pages = [p for p in content_pages if (low <= p["similarity_score"] < high if i < 9 else low <= p["similarity_score"] <= high)]
        if cluster_pages:
            positions = [p["gsc_position"] for p in cluster_pages if p["gsc_position"] is not None]
            cluster_bubbles.append({
                "range": f"{low:.1f}-{high:.1f}",
                "avg_similarity": round((low + high) / 2, 2),
                "total_clicks": sum(p["gsc_clicks"] for p in cluster_pages),
                "total_impressions": sum(p["gsc_impressions"] for p in cluster_pages),
                "avg_position": round(sum(positions) / len(positions), 1) if positions else None,
                "page_count": len(cluster_pages),
            })

    conn.close()

    return {
        "project": project_dict,
        "stats": {
            "total_pages": total_all,
            "total_pages_analyzed": total_analyzed,
            "structural_pages": structural_count,
            "avg_similarity": round(avg_sim, 3),
            "median_similarity": round(median_sim, 3),
            "pages_on_topic": on_topic,
            "pages_off_topic": off_topic,
            "pages_borderline": borderline,
            "dilution_ratio": round(dilution_ratio, 3),
            "dilution_ratio_weighted": round(dilution_ratio_weighted, 3),
        },
        "distribution": distribution,
        "pages": all_pages,
        "cluster_bubbles": cluster_bubbles,
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
    text = content.decode("utf-8-sig")  # Handle BOM
    count = upload_gsc_csv(project_id, text)
    return {"status": "ok", "rows_imported": count}


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
