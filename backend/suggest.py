import json
import logging

import aiohttp
from bs4 import BeautifulSoup
from openai import OpenAI

from config import settings

logger = logging.getLogger(__name__)

REMOVE_SELECTORS = [
    "nav", "header", "footer", "aside", "script", "style", "noscript",
    ".sidebar", ".menu", ".nav", ".footer", ".header", "#sidebar", "#menu",
]


async def _fetch_page(session: aiohttp.ClientSession, url: str) -> str:
    try:
        async with session.get(url, allow_redirects=True) as resp:
            if resp.status != 200:
                return ""
            ct = resp.headers.get("Content-Type", "")
            if "text/html" not in ct:
                return ""
            return await resp.text()
    except Exception:
        return ""


def _extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("main") or soup.select_one("article") or soup.find("body") or soup
    for sel in REMOVE_SELECTORS:
        for el in main.select(sel):
            el.decompose()
    return main.get_text(separator=" ", strip=True)


def _extract_nav_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    nav = soup.find("nav")
    if not nav:
        return []
    links = []
    for a in nav.find_all("a", href=True):
        href = a["href"]
        if href.startswith("/"):
            href = base_url.rstrip("/") + href
        if href.startswith(base_url):
            links.append(href)
    return links[:5]


async def suggest_keywords(domain: str) -> list[str]:
    base_url = f"https://{domain}"
    headers = {"User-Agent": "TopicDriftBot/1.0"}
    timeout = aiohttp.ClientTimeout(total=15)

    texts = []

    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
        # Fetch homepage
        home_html = await _fetch_page(session, base_url + "/")
        if home_html:
            texts.append(_extract_text(home_html))
            nav_links = _extract_nav_links(home_html, base_url)
            for link in nav_links:
                html = await _fetch_page(session, link)
                if html:
                    texts.append(_extract_text(html))

    if not texts:
        return []

    combined = "\n\n---\n\n".join(texts)
    # Truncate to ~4000 words
    words = combined.split()
    if len(words) > 4000:
        combined = " ".join(words[:4000])

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are an SEO expert. You always respond with valid JSON only, no markdown.",
            },
            {
                "role": "user",
                "content": f"""From the following content extracted from the main pages of {domain}, suggest 15-20 anchor keywords that represent the core business topic of this site.

These keywords must:
- Be BOFU (bottom of funnel) or transactional queries
- Cover the full product/service offering, not just one module
- Be queries where this site SHOULD rank to generate conversions
- Include a mix of generic terms and specific terms

Do NOT include: brand name, overly generic terms ("company", "solution"), purely informational terms.

Return ONLY a JSON array of strings, nothing else.

Page content:
{combined}""",
            },
        ],
        temperature=0.3,
        max_tokens=1000,
    )

    text = response.choices[0].message.content.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        keywords = json.loads(text)
        if isinstance(keywords, list):
            return [str(k) for k in keywords]
    except json.JSONDecodeError:
        logger.warning(f"Failed to parse keyword suggestions: {text}")

    return []
