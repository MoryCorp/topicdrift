# TopicDrift

Standalone tool for analyzing semantic proximity and topic dilution on websites. Detects when a site drifts away from its core business topic by computing semantic similarity between page content and anchor keywords.

## Features

- **Async web crawler** — crawls a domain (BFS + sitemap), extracts clean content
- **Semantic scoring** — uses OpenAI embeddings to compute cosine similarity vs. anchor keywords
- **Google Search Console** — OAuth2 integration or CSV upload for traffic-weighted analysis
- **Visual dashboard** — scatter plots, distribution charts, sortable/filterable page table
- **Dilution ratio** — quantifies how much of a site is off-topic (raw and traffic-weighted)

## Quick Start

```bash
cp .env.example .env
# Edit .env with your OpenAI API key (required) and GSC credentials (optional)

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/docs

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for text embeddings |
| `GSC_CLIENT_ID` | No | Google OAuth2 client ID for Search Console |
| `GSC_CLIENT_SECRET` | No | Google OAuth2 client secret |
| `GSC_REDIRECT_URI` | No | OAuth2 redirect URI (default: http://localhost:8000/api/gsc/callback) |
| `MAX_CRAWL_PAGES` | No | Max pages to crawl per project (default: 300) |
| `MAX_CRAWL_DEPTH` | No | Max crawl depth (default: 3) |
| `CRAWL_DELAY` | No | Delay between requests in seconds (default: 0.5) |

## Development

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Architecture

- **Backend**: Python 3.12 + FastAPI + SQLite (WAL mode)
- **Frontend**: React 18 + Vite + Tailwind CSS + Recharts
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensions)
- **Deploy**: Docker Compose (backend + frontend/nginx)

## License

MIT
