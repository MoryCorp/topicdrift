import asyncio
import re
import logging
from urllib.parse import urljoin, urlparse, urlunparse
from typing import Set

import aiohttp
from bs4 import BeautifulSoup

from database import get_connection

logger = logging.getLogger(__name__)

IGNORED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".pdf", ".zip", ".tar", ".gz", ".mp3", ".mp4", ".avi",
    ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
}

IGNORED_PATHS = {
    "/wp-admin", "/wp-json", "/feed", "/author/", "/tag/",
    "/cart", "/checkout", "/my-account", "/wp-login",
}

REMOVE_SELECTORS = [
    "nav", "header", "footer", "aside", "script", "style", "noscript",
    ".sidebar", ".menu", ".nav", ".footer", ".header",
    "#sidebar", "#menu",
]


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    normalized = urlunparse((
        parsed.scheme,
        parsed.netloc.lower(),
        path.lower(),
        "",  # params
        "",  # query (strip tracking params)
        "",  # fragment
    ))
    return normalized


def should_skip_url(url: str, domain: str) -> bool:
    parsed = urlparse(url)
    if parsed.netloc.lower().replace("www.", "") != domain.lower().replace("www.", ""):
        return True
    ext = re.search(r"\.\w+$", parsed.path)
    if ext and ext.group().lower() in IGNORED_EXTENSIONS:
        return True
    for ignored in IGNORED_PATHS:
        if ignored in parsed.path.lower():
            return True
    return False


def extract_content(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()

    h1 = ""
    h1_tag = soup.find("h1")
    if h1_tag:
        h1 = h1_tag.get_text(strip=True)

    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    if meta_tag and meta_tag.get("content"):
        meta_desc = meta_tag["content"].strip()

    # Find main content area
    main_content = None
    for selector in ["main", "article", "[role=main]", ".content", "#content"]:
        main_content = soup.select_one(selector)
        if main_content:
            break
    if not main_content:
        main_content = soup.find("body")
    if not main_content:
        main_content = soup

    # Remove noise elements
    for sel in REMOVE_SELECTORS:
        for el in main_content.select(sel):
            el.decompose()

    content_text = main_content.get_text(separator=" ", strip=True)
    word_count = len(content_text.split())

    # Extract internal links
    links = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        links.add(href)

    return {
        "title": title,
        "h1": h1,
        "meta_description": meta_desc,
        "content_text": content_text,
        "word_count": word_count,
        "links": links,
    }


def parse_sitemap(text: str, domain: str) -> Set[str]:
    urls = set()
    soup = BeautifulSoup(text, "lxml-xml")
    for loc in soup.find_all("loc"):
        url = loc.get_text(strip=True)
        if not should_skip_url(url, domain):
            urls.add(normalize_url(url))
    return urls


async def crawl_site(project_id: int, domain: str, max_pages: int, max_depth: int, delay: float):
    conn = get_connection()
    cursor = conn.cursor()

    # Get or create crawl job
    cursor.execute(
        "INSERT INTO crawl_jobs (project_id, status, started_at) VALUES (?, 'running', datetime('now'))",
        (project_id,)
    )
    job_id = cursor.lastrowid
    conn.commit()

    cursor.execute("UPDATE projects SET status='crawling', updated_at=datetime('now') WHERE id=?", (project_id,))
    conn.commit()

    # Clear previous pages
    cursor.execute("DELETE FROM pages WHERE project_id=?", (project_id,))
    conn.commit()

    base_url = f"https://{domain}"
    visited: Set[str] = set()
    queue: list[tuple[str, int]] = []  # (url, depth)

    # Seed with homepage
    homepage = normalize_url(base_url + "/")
    queue.append((homepage, 0))

    headers = {"User-Agent": "TopicDriftBot/1.0"}
    timeout = aiohttp.ClientTimeout(total=15)

    try:
        async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
            # Try sitemap
            try:
                async with session.get(f"{base_url}/sitemap.xml") as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        sitemap_urls = parse_sitemap(text, domain)
                        for url in sitemap_urls:
                            if url not in visited:
                                queue.append((url, 1))
            except Exception:
                pass

            # Update pages_found
            cursor.execute("UPDATE crawl_jobs SET pages_found=? WHERE id=?", (len(queue), job_id))
            conn.commit()

            while queue and len(visited) < max_pages:
                url, depth = queue.pop(0)

                if url in visited:
                    continue
                if depth > max_depth:
                    continue

                visited.add(url)

                try:
                    async with session.get(url, allow_redirects=True) as resp:
                        status_code = resp.status
                        if status_code != 200:
                            cursor.execute(
                                "INSERT OR IGNORE INTO pages (project_id, url, status_code) VALUES (?, ?, ?)",
                                (project_id, url, status_code)
                            )
                            conn.commit()
                            continue

                        content_type = resp.headers.get("Content-Type", "")
                        if "text/html" not in content_type:
                            continue

                        html = await resp.text()

                except Exception as e:
                    logger.warning(f"Failed to fetch {url}: {e}")
                    continue

                data = extract_content(html)

                # Store page
                if data["word_count"] >= 50:
                    cursor.execute(
                        """INSERT OR REPLACE INTO pages
                        (project_id, url, title, h1, meta_description, content_text, word_count, status_code, crawled_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                        (project_id, url, data["title"], data["h1"],
                         data["meta_description"], data["content_text"],
                         data["word_count"], status_code)
                    )
                    conn.commit()

                # Discover new links
                for link in data["links"]:
                    abs_url = normalize_url(urljoin(url, link))
                    if abs_url not in visited and not should_skip_url(abs_url, domain):
                        queue.append((abs_url, depth + 1))

                # Update crawl job progress
                pages_crawled = len(visited)
                pages_found = max(len(visited) + len(queue), pages_crawled)
                cursor.execute(
                    "UPDATE crawl_jobs SET pages_found=?, pages_crawled=? WHERE id=?",
                    (pages_found, pages_crawled, job_id)
                )
                conn.commit()

                await asyncio.sleep(delay)

        # Done
        cursor.execute(
            "UPDATE crawl_jobs SET status='done', finished_at=datetime('now') WHERE id=?",
            (job_id,)
        )
        cursor.execute("UPDATE projects SET status='crawled', updated_at=datetime('now') WHERE id=?", (project_id,))
        conn.commit()

    except Exception as e:
        logger.exception(f"Crawl failed for project {project_id}")
        cursor.execute(
            "UPDATE crawl_jobs SET status='error', error=?, finished_at=datetime('now') WHERE id=?",
            (str(e), job_id)
        )
        cursor.execute("UPDATE projects SET status='crawled', updated_at=datetime('now') WHERE id=?", (project_id,))
        conn.commit()
    finally:
        conn.close()
