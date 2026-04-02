import sqlite3
import os
from config import settings


def get_connection() -> sqlite3.Connection:
    db_path = settings.database_path
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            domain TEXT NOT NULL,
            anchor_keywords TEXT DEFAULT '[]',
            anchor_embedding BLOB,
            centroid_embedding BLOB,
            lang_filter TEXT,
            threshold_off_topic REAL DEFAULT 0.5,
            threshold_on_topic REAL DEFAULT 0.7,
            status TEXT DEFAULT 'created',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            path TEXT NOT NULL DEFAULT '/',
            title TEXT,
            h1 TEXT,
            meta_description TEXT,
            content_text TEXT,
            word_count INTEGER DEFAULT 0,
            lang TEXT,
            page_type TEXT DEFAULT 'content',
            embedding BLOB,
            similarity_score REAL,
            centroid_similarity REAL,
            status_code INTEGER,
            crawled_at TEXT DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_project_url ON pages(project_id, url);

        CREATE TABLE IF NOT EXISTS gsc_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            page_url TEXT NOT NULL,
            query TEXT NOT NULL DEFAULT '',
            clicks INTEGER DEFAULT 0,
            impressions INTEGER DEFAULT 0,
            ctr REAL DEFAULT 0.0,
            position REAL DEFAULT 0.0,
            date TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_gsc_project_page ON gsc_data(project_id, page_url);
        CREATE INDEX IF NOT EXISTS idx_gsc_project_date ON gsc_data(project_id, date);

        CREATE TABLE IF NOT EXISTS gsc_tokens (
            project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            token_json TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crawl_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            status TEXT DEFAULT 'pending',
            pages_found INTEGER DEFAULT 0,
            pages_crawled INTEGER DEFAULT 0,
            pages_skipped_lang INTEGER DEFAULT 0,
            pages_skipped_thin INTEGER DEFAULT 0,
            started_at TEXT,
            finished_at TEXT,
            error TEXT
        );
    """)

    _migrate(cursor)
    conn.commit()
    conn.close()


def _migrate(cursor):
    existing = set()
    for table in ["projects", "pages", "crawl_jobs"]:
        for row in cursor.execute(f"PRAGMA table_info({table})"):
            existing.add(f"{table}.{row[1]}")

    migrations = [
        ("projects", "lang_filter", "TEXT"),
        ("projects", "threshold_off_topic", "REAL DEFAULT 0.5"),
        ("projects", "threshold_on_topic", "REAL DEFAULT 0.7"),
        ("projects", "centroid_embedding", "BLOB"),
        ("pages", "path", "TEXT NOT NULL DEFAULT '/'"),
        ("pages", "lang", "TEXT"),
        ("pages", "page_type", "TEXT DEFAULT 'content'"),
        ("pages", "centroid_similarity", "REAL"),
        ("crawl_jobs", "pages_skipped_lang", "INTEGER DEFAULT 0"),
        ("crawl_jobs", "pages_skipped_thin", "INTEGER DEFAULT 0"),
    ]

    for table, col, col_type in migrations:
        if f"{table}.{col}" not in existing:
            try:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
            except Exception:
                pass
