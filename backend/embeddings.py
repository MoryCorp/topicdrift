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

        cursor.execute("SELECT anchor_keywords FROM projects WHERE id=?", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Project {project_id} not found")

        keywords = json.loads(row["anchor_keywords"])
        if not keywords:
            raise ValueError("No anchor keywords defined")

        client = get_client()

        # Step 1: Compute anchor embedding
        logger.info(f"Computing anchor embedding from {len(keywords)} keywords")
        keyword_embeddings = get_embeddings_batch(client, keywords)
        anchor_vec = np.mean([np.array(e) for e in keyword_embeddings], axis=0)
        anchor_blob = serialize_embedding(anchor_vec)

        cursor.execute(
            "UPDATE projects SET anchor_embedding=?, updated_at=datetime('now') WHERE id=?",
            (anchor_blob, project_id)
        )
        conn.commit()

        # Step 2: Compute page embeddings
        cursor.execute(
            "SELECT id, content_text FROM pages WHERE project_id=? AND word_count >= 50 AND content_text IS NOT NULL",
            (project_id,)
        )
        pages = cursor.fetchall()
        logger.info(f"Computing embeddings for {len(pages)} pages")

        all_page_vecs = []  # (page_id, numpy_vec)
        batch_ids = []
        batch_texts = []

        for page in pages:
            batch_ids.append(page["id"])
            batch_texts.append(truncate_text(page["content_text"]))

            if len(batch_texts) >= BATCH_SIZE:
                vecs = _embed_batch(client, batch_ids, batch_texts)
                all_page_vecs.extend(vecs)
                # Store embeddings immediately
                for pid, vec in vecs:
                    cursor.execute("UPDATE pages SET embedding=? WHERE id=?", (serialize_embedding(vec), pid))
                conn.commit()
                batch_ids = []
                batch_texts = []

        if batch_texts:
            vecs = _embed_batch(client, batch_ids, batch_texts)
            all_page_vecs.extend(vecs)
            for pid, vec in vecs:
                cursor.execute("UPDATE pages SET embedding=? WHERE id=?", (serialize_embedding(vec), pid))
            conn.commit()

        if not all_page_vecs:
            raise ValueError("No pages with content to analyze")

        # Step 3: Compute centroid (mean of ALL page embeddings)
        logger.info("Computing site centroid")
        centroid_vec = np.mean([vec for _, vec in all_page_vecs], axis=0)
        centroid_blob = serialize_embedding(centroid_vec)

        cursor.execute(
            "UPDATE projects SET centroid_embedding=?, updated_at=datetime('now') WHERE id=?",
            (centroid_blob, project_id)
        )
        conn.commit()

        # Step 4: Compute both similarity scores for each page
        logger.info("Computing dual similarity scores")
        for page_id, vec in all_page_vecs:
            sim_anchor = cosine_similarity(vec, anchor_vec)
            sim_centroid = cosine_similarity(vec, centroid_vec)
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


def _embed_batch(client, ids, texts):
    embeddings = get_embeddings_batch(client, texts)
    return [(pid, np.array(emb)) for pid, emb in zip(ids, embeddings)]
