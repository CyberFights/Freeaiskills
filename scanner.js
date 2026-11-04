/**
 * GitHub scanner: continuously queries the GitHub Search API for the latest
 * and most popular free AI skills, tools, agents and libraries, then caches
 * the merged, de-duplicated results to data/cache.json.
 *
 * Uses GITHUB_TOKEN / GH_TOKEN from the environment when present to raise
 * rate limits (search API: 10 req/min unauthenticated, 30 req/min with token).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 15 * 60 * 1000);
const PER_PAGE = 30;
const CONCURRENCY = 3;

/**
 * Curated categories. Each entry lists GitHub repository-search queries.
 * `sort: 'stars'` surfaces the most popular; `sort: 'updated'` surfaces the latest.
 */
const CATEGORIES = [
  {
    id: 'agents',
    name: 'AI Agents',
    icon: '🤖',
    queries: [
      { q: 'topic:ai-agents', sort: 'stars' },
      { q: 'topic:llm-agents', sort: 'stars' },
      { q: 'topic:autonomous-agents', sort: 'stars' },
      { q: 'ai agent framework in:description', sort: 'stars' },
      { q: 'topic:ai-agents', sort: 'updated' },
    ],
  },
  {
    id: 'llm-tools',
    name: 'LLM Apps & Tools',
    icon: '🧠',
    queries: [
      { q: 'topic:llm', sort: 'stars' },
      { q: 'topic:generative-ai', sort: 'stars' },
      { q: 'topic:large-language-model', sort: 'stars' },
      { q: 'llm tool in:description', sort: 'stars' },
      { q: 'topic:llm', sort: 'updated' },
    ],
  },
  {
    id: 'skills',
    name: 'Skills & Prompts',
    icon: '✨',
    queries: [
      { q: 'ai skills in:name,description', sort: 'stars' },
      { q: 'topic:claude-skills', sort: 'stars' },
      { q: 'topic:prompt-engineering', sort: 'stars' },
      { q: 'prompt library in:name,description', sort: 'stars' },
      { q: 'ai skills in:name,description', sort: 'updated' },
    ],
  },
  {
    id: 'mcp',
    name: 'MCP Servers',
    icon: '🔌',
    queries: [
      { q: 'topic:mcp-server', sort: 'stars' },
      { q: 'topic:mcp', sort: 'stars' },
      { q: 'mcp server in:name,description', sort: 'stars' },
      { q: 'model context protocol in:description', sort: 'stars' },
      { q: 'topic:mcp-server', sort: 'updated' },
    ],
  },
  {
    id: 'coding',
    name: 'Coding Assistants',
    icon: '💻',
    queries: [
      { q: 'ai code assistant in:description', sort: 'stars' },
      { q: 'topic:copilot', sort: 'stars' },
      { q: 'ai pair programmer in:description', sort: 'stars' },
      { q: 'code generation llm in:description', sort: 'stars' },
      { q: 'ai code assistant in:description', sort: 'updated' },
    ],
  },
  {
    id: 'image-video',
    name: 'Image & Video AI',
    icon: '🎨',
    queries: [
      { q: 'topic:text-to-image', sort: 'stars' },
      { q: 'topic:stable-diffusion', sort: 'stars' },
      { q: 'topic:image-generation', sort: 'stars' },
      { q: 'ai video generation in:description', sort: 'stars' },
      { q: 'topic:text-to-image', sort: 'updated' },
    ],
  },
  {
    id: 'audio',
    name: 'Speech & Audio',
    icon: '🔊',
    queries: [
      { q: 'topic:text-to-speech', sort: 'stars' },
      { q: 'topic:speech-to-text', sort: 'stars' },
      { q: 'topic:speech-recognition', sort: 'stars' },
      { q: 'voice cloning in:description', sort: 'stars' },
      { q: 'topic:text-to-speech', sort: 'updated' },
    ],
  },
  {
    id: 'rag',
    name: 'RAG & Vector Search',
    icon: '🔍',
    queries: [
      { q: 'topic:retrieval-augmented-generation', sort: 'stars' },
      { q: 'topic:vector-database', sort: 'stars' },
      { q: 'rag pipeline in:description', sort: 'stars' },
      { q: 'semantic search llm in:description', sort: 'stars' },
      { q: 'topic:vector-database', sort: 'updated' },
    ],
  },
  {
    id: 'automation',
    name: 'Automation & Workflows',
    icon: '⚙️',
    queries: [
      { q: 'ai automation in:description', sort: 'stars' },
      { q: 'topic:workflow-automation', sort: 'stars' },
      { q: 'topic:ai-automation', sort: 'stars' },
      { q: 'agent workflow orchestration in:description', sort: 'stars' },
      { q: 'ai automation in:description', sort: 'updated' },
    ],
  },
  {
    id: 'awesome',
    name: 'Awesome Lists & Directories',
    icon: '🏆',
    queries: [
      { q: 'awesome ai in:name', sort: 'stars' },
      { q: 'awesome llm in:name', sort: 'stars' },
      { q: 'awesome ai tools in:name', sort: 'stars' },
      { q: 'awesome mcp in:name', sort: 'stars' },
      { q: 'awesome ai in:name', sort: 'updated' },
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pace outbound Search API calls so we stay under the rate limit even
// without a token (10 req/min unauthenticated, 30 req/min with token).
const MIN_INTERVAL_MS = TOKEN ? 2200 : 6500;
let lastRequestAt = 0;
async function pace() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function apiHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'freeaiskills-scanner',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return headers;
}

async function searchOnce(query) {
  const url =
    'https://api.github.com/search/repositories?' +
    new URLSearchParams({
      q: `${query.q} fork:true`,
      sort: query.sort,
      order: 'desc',
      per_page: String(PER_PAGE),
    }).toString();

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: apiHeaders() });
    const remaining = Number(res.headers.get('x-ratelimit-remaining') || '0');
    const reset = Number(res.headers.get('x-ratelimit-reset') || '0');

    if (res.status === 403 || res.status === 429) {
      // Rate limited: wait until reset (or a capped backoff) and retry.
      const waitMs = reset
        ? Math.min(Math.max((reset * 1000 - Date.now()), 1000), 120000)
        : Math.min(attempt * 15000, 90000);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for "${query.q}" (remaining=${remaining})`);
    }
    const data = await res.json();
    return data.items || [];
  }
  throw new Error(`Gave up on "${query.q}" after rate-limit retries`);
}

async function runPool(items, worker) {
  const results = [];
  let idx = 0;
  async function lane() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = await worker(items[i]);
      } catch (err) {
        results[i] = { error: err.message };
        console.error(`[scan] query failed: ${items[i].q} :: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
  return results;
}

function normalizeRepo(item, categoryId) {
  return {
    id: item.id,
    name: item.full_name,
    description: item.description || '',
    url: item.html_url,
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    language: item.language || 'Other',
    topics: item.topics || [],
    license: item.license ? item.license.spdx_id : 'Unlicensed',
    updatedAt: item.updated_at,
    pushedAt: item.pushed_at,
    archived: !!item.archived,
    categories: [categoryId],
  };
}

async function scanOnce() {
  const startedAt = new Date().toISOString();
  console.log(`[scan] starting full scan at ${startedAt}`);

  const jobs = [];
  for (const cat of CATEGORIES) {
    for (const query of cat.queries) jobs.push({ ...query, category: cat.id });
  }

  const results = await runPool(jobs, async (job) => {
    const items = await searchOnce(job);
    return { category: job.category, items };
  });

  const byId = new Map();
  let scanned = 0;
  for (const r of results) {
    if (r.error) continue;
    scanned += r.items.length;
    for (const item of r.items) {
      if (item.archived) continue;
      const repo = normalizeRepo(item, r.category);
      const existing = byId.get(repo.id);
      if (!existing) {
        byId.set(repo.id, repo);
      } else {
        existing.stars = Math.max(existing.stars, repo.stars);
        if (repo.description && !existing.description) existing.description = repo.description;
        if (!existing.categories.includes(r.category)) existing.categories.push(r.category);
        if (repo.updatedAt > existing.updatedAt) existing.updatedAt = repo.updatedAt;
      }
    }
  }

  const repos = [...byId.values()].sort((a, b) => b.stars - a.stars);
  const cache = {
    scannedAt: new Date().toISOString(),
    scanStartedAt: startedAt,
    fetched: scanned,
    count: repos.length,
    categories: CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      count: repos.filter((r) => r.categories.includes(c.id)).length,
    })),
    repos,
  };

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = CACHE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, CACHE_FILE);

  console.log(`[scan] done: ${repos.length} unique repos from ${scanned} results at ${cache.scannedAt}`);
  return cache;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

let scanning = false;
let timer = null;

async function scanLoop() {
  if (scanning) return;
  scanning = true;
  try {
    await scanOnce();
  } catch (err) {
    console.error(`[scan] fatal: ${err.message}`);
  } finally {
    scanning = false;
  }
}

function startScheduler() {
  scanLoop(); // initial scan immediately
  timer = setInterval(scanLoop, SCAN_INTERVAL_MS);
  if (timer.unref) timer.unref();
  console.log(`[scan] scheduler started, interval ${SCAN_INTERVAL_MS / 60000} min`);
}

module.exports = { CATEGORIES, scanOnce, scanLoop, startScheduler, readCache };

if (require.main === module) {
  startScheduler();
  setInterval(() => {}, 60000); // keep process alive
}
