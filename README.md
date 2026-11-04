# Free AI Skills

A website that **continuously scans GitHub** for the latest and most popular **free AI skills, agents, MCP servers, and tools**, and presents them on a searchable page organized by category.

## Features

- 🛰️ **Automatic scanning** — a background scheduler queries the GitHub Search API every 15 minutes (most popular *and* recently updated repos across 10 categories).
- 🗂️ **Categories** — AI Agents, LLM Apps & Tools, Skills & Prompts, MCP Servers, Coding Assistants, Image & Video AI, Speech & Audio, RAG & Vector Search, Automation & Workflows, Awesome Lists.
- 🔍 **Live search** — filter by name, description, or topic; sort by stars, recent updates, or name.
- ⟳ **Manual rescan** — one click re-scans GitHub; the UI shows the last scan time.
- 💾 Results are cached to `data/cache.json` so the page is instant even between scans.

## Run

```bash
# Optional: provide a token for higher GitHub API rate limits
GH_TOKEN=$(gh auth token) node server.js
# then open http://localhost:3000
```

On Railway, add a `GH_TOKEN` (or `GITHUB_TOKEN`) environment variable with a GitHub token to raise the Search API rate limit from 10 to 30 requests/minute. Without it the scanner still works — it paces requests to stay under the unauthenticated limit.

No dependencies — plain Node.js (18+) and vanilla HTML/CSS/JS.

## How it works

- `scanner.js` — queries `api.github.com/search/repositories` for curated per-category queries (`topic:` filters + keyword searches, sorted by `stars` and `updated`), merges and de-duplicates repos, and caches them.
- `server.js` — zero-dependency HTTP server: serves `public/` and a JSON API (`/api/skills`, `/api/meta`, `POST /api/refresh`) backed by the cache.
- `public/` — the single-page UI.
