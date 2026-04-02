import json
import logging
import numpy as np
from openai import OpenAI

from config import settings
from database import get_connection

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
MAX_TOKENS_APPROX = 8000  # Conservative word-based approximation
BATCH_SIZE = 100


def get_client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def truncate_text(text: str, max_words: int = MAX_TOKENS_APPROX) -> str:
    words = text.split()
    if len(words) > max_words:
        return " ".join(words[:max_words])
    return text


def get_embeddings_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
    )
    return [item.embedding for item in response.data]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def serialize_embedding(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def deserialize_embedding(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def analyze_project(project_id: int):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("UPDATE projects SET status='analyzing', updated_at=datetime('now') WHERE id=?", (project_id,))
        conn.commit()

        # Get project info
        cursor.execute("SELECT anchor_keywords FROM projects WHERE id=?", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Project {project_id} not found")

        keywords = json.loads(row["anchor_keywords"])
        if not keywords:
            raise ValueError("No anchor keywords defined")

        client = get_client()

        # 1. Compute anchor embedding (mean of keyword embeddings)
        keyword_embeddings = get_embeddings_batch(client, keywords)
        anchor_vec = np.mean([np.array(e) for e in keyword_embeddings], axis=0)
        anchor_blob = serialize_embedding(anchor_vec)

        cursor.execute(
            "UPDATE projects SET anchor_embedding=?, updated_at=datetime('now') WHERE id=?",
            (anchor_blob, project_id)
        )
        conn.commit()

        # 2. Get all pages with content
        cursor.execute(
            "SELECT id, content_text FROM pages WHERE project_id=? AND word_count >= 50 AND content_text IS NOT NULL",
            (project_id,)
        )
        pages = cursor.fetchall()

        # 3. Process in batches
        batch_ids = []
        batch_texts = []

        for page in pages:
            batch_ids.append(page["id"])
            batch_texts.append(truncate_text(page["content_text"]))

            if len(batch_texts) >= BATCH_SIZE:
                _process_batch(cursor, conn, client, batch_ids, batch_texts, anchor_vec)
                batch_ids = []
                batch_texts = []

        # Process remaining
        if batch_texts:
            _process_batch(cursor, conn, client, batch_ids, batch_texts, anchor_vec)

        cursor.execute("UPDATE projects SET status='done', updated_at=datetime('now') WHERE id=?", (project_id,))
        conn.commit()

    except Exception as e:
        logger.exception(f"Analysis failed for project {project_id}")
        cursor.execute(
            "UPDATE projects SET status='crawled', updated_at=datetime('now') WHERE id=?",
            (project_id,)
        )
        conn.commit()
        raise
    finally:
        conn.close()


def _process_batch(cursor, conn, client, ids, texts, anchor_vec):
    embeddings = get_embeddings_batch(client, texts)
    for page_id, emb in zip(ids, embeddings):
        vec = np.array(emb)
        sim = cosine_similarity(vec, anchor_vec)
        blob = serialize_embedding(vec)
        cursor.execute(
            "UPDATE pages SET embedding=?, similarity_score=? WHERE id=?",
            (blob, sim, page_id)
        )
    conn.commit()
