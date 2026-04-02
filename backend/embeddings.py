import json
import logging
import numpy as np
from openai import OpenAI

from config import settings
from database import get_connection

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
MAX_TOKENS_APPROX = 8000
BATCH_SIZE = 100


def get_client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def truncate_text(text: str, max_words: int = MAX_TOKENS_APPROX) -> str:
    words = text.split()
    if len(words) > max_words:
        return " ".join(words[:max_words])
    return text


def get_embeddings_batch(client: OpenAI, texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def cosine_similarity_np(a: np.ndarray, b: np.ndarray) -> float:
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

        cursor.execute("SELECT anchor_keywords FROM projects WHERE id=?", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Project {project_id} not found")

        keywords = json.loads(row["anchor_keywords"])
        if not keywords:
            raise ValueError("No anchor keywords defined")

        # Get all pages with content
        cursor.execute(
            "SELECT id, content_text FROM pages WHERE project_id=? AND word_count >= 50 AND content_text IS NOT NULL",
            (project_id,)
        )
        pages = cursor.fetchall()
        if not pages:
            raise ValueError("No pages with content to analyze")

        page_ids = [p["id"] for p in pages]
        page_texts = [p["content_text"] for p in pages]

        logger.info(f"Analyzing {len(pages)} pages for project {project_id}")
        client = get_client()

        # Step 1: Anchor embedding (mean of keyword embeddings)
        logger.info(f"Computing anchor embedding from {len(keywords)} keywords")
        keyword_embeddings = get_embeddings_batch(client, keywords)
        anchor_vec = np.mean([np.array(e) for e in keyword_embeddings], axis=0)
        cursor.execute(
            "UPDATE projects SET anchor_embedding=?, updated_at=datetime('now') WHERE id=?",
            (serialize_embedding(anchor_vec), project_id)
        )
        conn.commit()

        # Step 2: Page embeddings in batches
        all_page_vecs = []
        for batch_start in range(0, len(page_ids), BATCH_SIZE):
            batch_ids = page_ids[batch_start:batch_start + BATCH_SIZE]
            batch_texts = [truncate_text(t) for t in page_texts[batch_start:batch_start + BATCH_SIZE]]
            embeddings = get_embeddings_batch(client, batch_texts)
            for pid, emb in zip(batch_ids, embeddings):
                vec = np.array(emb)
                all_page_vecs.append((pid, vec))
                cursor.execute("UPDATE pages SET embedding=? WHERE id=?", (serialize_embedding(vec), pid))
            conn.commit()
            logger.info(f"Embedded {min(batch_start + BATCH_SIZE, len(page_ids))}/{len(page_ids)} pages")

        # Step 3: Site centroid (mean of all page embeddings)
        logger.info("Computing site centroid")
        centroid_vec = np.mean([vec for _, vec in all_page_vecs], axis=0)
        cursor.execute(
            "UPDATE projects SET centroid_embedding=?, updated_at=datetime('now') WHERE id=?",
            (serialize_embedding(centroid_vec), project_id)
        )
        conn.commit()

        # Step 4: Both similarity scores for each page
        logger.info("Computing dual similarity scores")
        for page_id, vec in all_page_vecs:
            sim_anchor = cosine_similarity_np(vec, anchor_vec)
            sim_centroid = cosine_similarity_np(vec, centroid_vec)
            cursor.execute(
                "UPDATE pages SET similarity_score=?, centroid_similarity=? WHERE id=?",
                (sim_anchor, sim_centroid, page_id)
            )
        conn.commit()

        cursor.execute("UPDATE projects SET status='done', updated_at=datetime('now') WHERE id=?", (project_id,))
        conn.commit()
        logger.info(f"Analysis complete for project {project_id}")

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
