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

LANG_PREFIXES = ["/en/", "/es/", "/de/", "/it/", "/pt/", "/nl/", "/ja/", "/zh/", "/fr/", "/ko/", "/ru/", "/ar/"]

STRUCTURAL_URL_PATTERNS = [
    "/legal", "/privacy", "/mentions-legales", "/politique-confidentialite",
    "/cgv", "/cgu", "/contact", "/equipe", "/team", "/hiring",
    "/recrutement", "/careers", "/plan-du-site", "/sitemap",
    "/terms", "/conditions", "/about", "/a-propos", "/impressum",
]

STRUCTURAL_TITLE_PATTERNS = [
    "mentions légales", "privacy", "politique de confidentialité",
    "cgv", "cgu", "legal notice", "hiring", "recrutement", "careers",
    "terms of service", "terms and conditions", "impressum",
]

BLOG_URL_PATTERNS = ["/blog/", "/article/", "/actualites/", "/news/", "/articles/", "/posts/"]


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    # Strip UTM and tracking params
    clean_query = ""
    if parsed.query:
        params = [p for p in parsed.query.split("&")
                  if not p.lower().startswith(("utm_", "fbclid", "gclid", "mc_", "ref="))]
        clean_query = "&".join(params)
    return urlunparse((
        parsed.scheme,
        parsed.netloc.lower(),
        path.lower(),
        "",
        clean_query,
        "",
    ))


def get_path(url: str) -> str:
    return urlparse(url).path or "/"


def should_skip_url(url: str, domain: str) -> bool:
    parsed = urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")
    target = domain.lower().replace("www.", "")
    if host != target:
        return True
    ext = re.search(r"\.\w+$", parsed.path)
    if ext and ext.group().lower() in IGNORED_EXTENSIONS:
        return True
    for ignored in IGNORED_PATHS:
        if ignored in parsed.path.lower():
            return True
    return False


def should_skip_url_lang(url: str, lang_filter: str | None) -> bool:
    """Pre-filter URLs by language prefix."""
    if not lang_filter:
        return False
    path = urlparse(url).path.lower()
    target_prefix = f"/{lang_filter}/"
    for prefix in LANG_PREFIXES:
        if path.startswith(prefix):
            return prefix != target_prefix
    return False


def detect_page_type(url: str, title: str | None) -> str:
    path = urlparse(url).path.lower()
    title_lower = (title or "").lower()

    for pattern in STRUCTURAL_URL_PATTERNS:
        if pattern in path:
            return "structural"
    for pattern in STRUCTURAL_TITLE_PATTERNS:
        if pattern in title_lower:
            return "structural"
    for pattern in BLOG_URL_PATTERNS:
        if pattern in path:
            return "blog"
    return "content"


def extract_content(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    # Language
    html_tag = soup.find("html")
    lang = html_tag.get("lang", "").strip() if html_tag else ""

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
        "lang": lang,
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


async def crawl_site(
    project_id: int,
    domain: str,
    max_pages: int,
    max_depth: int,
    delay: float,
    lang_filter: str | None = None,
):
    conn = get_connection()
    cursor = conn.cursor()

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
    queue: list[tuple[str, int]] = []
    skipped_lang = 0
    skipped_thin = 0

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
                            if url not in visited and not should_skip_url_lang(url, lang_filter):
                                queue.append((url, 1))
            except Exception:
                pass

            cursor.execute("UPDATE crawl_jobs SET pages_found=? WHERE id=?", (len(queue), job_id))
            conn.commit()

            while queue and len(visited) < max_pages:
                url, depth = queue.pop(0)

                if url in visited:
                    continue
                if depth > max_depth:
                    continue
                if should_skip_url_lang(url, lang_filter):
                    skipped_lang += 1
                    visited.add(url)
                    continue

                visited.add(url)

                try:
                    async with session.get(url, allow_redirects=True) as resp:
                        status_code = resp.status
                        if status_code != 200:
                            continue

                        content_type = resp.headers.get("Content-Type", "")
                        if "text/html" not in content_type:
                            continue

                        html = await resp.text()

                except Exception as e:
                    logger.warning(f"Failed to fetch {url}: {e}")
                    continue

                data = extract_content(html)

                # Post-filter by lang attribute
                if lang_filter and data["lang"]:
                    page_lang = data["lang"][:2].lower()
                    if page_lang != lang_filter[:2].lower():
                        skipped_lang += 1
                        cursor.execute(
                            "UPDATE crawl_jobs SET pages_skipped_lang=? WHERE id=?",
                            (skipped_lang, job_id)
                        )
                        conn.commit()
                        # Still discover links
                        for link in data["links"]:
                            abs_url = normalize_url(urljoin(url, link))
                            if abs_url not in visited and not should_skip_url(abs_url, domain):
                                queue.append((abs_url, depth + 1))
                        await asyncio.sleep(delay)
                        continue

                # Thin content check
                if data["word_count"] < 50:
                    skipped_thin += 1
                    cursor.execute(
                        "UPDATE crawl_jobs SET pages_skipped_thin=? WHERE id=?",
                        (skipped_thin, job_id)
                    )
                    conn.commit()
                    for link in data["links"]:
                        abs_url = normalize_url(urljoin(url, link))
                        if abs_url not in visited and not should_skip_url(abs_url, domain):
                            queue.append((abs_url, depth + 1))
                    await asyncio.sleep(delay)
                    continue

                page_type = detect_page_type(url, data["title"])
                path = get_path(url)

                cursor.execute(
                    """INSERT OR REPLACE INTO pages
                    (project_id, url, path, title, h1, meta_description, content_text,
                     word_count, lang, page_type, status_code, crawled_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                    (project_id, url, path, data["title"], data["h1"],
                     data["meta_description"], data["content_text"],
                     data["word_count"], data["lang"], page_type, status_code)
                )
                conn.commit()

                # Discover new links
                for link in data["links"]:
                    abs_url = normalize_url(urljoin(url, link))
                    if abs_url not in visited and not should_skip_url(abs_url, domain):
                        queue.append((abs_url, depth + 1))

                pages_crawled = len(visited) - skipped_lang - skipped_thin
                pages_found = max(len(visited) + len(queue), pages_crawled)
                cursor.execute(
                    "UPDATE crawl_jobs SET pages_found=?, pages_crawled=?, pages_skipped_lang=?, pages_skipped_thin=? WHERE id=?",
                    (pages_found, pages_crawled, skipped_lang, skipped_thin, job_id)
                )
                conn.commit()

                await asyncio.sleep(delay)

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
