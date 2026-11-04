/**
 * Free AI Skills — web server.
 * Serves the static UI from public/ and a JSON API backed by the scanner cache.
 * The scanner re-scans GitHub on a schedule (see scanner.js).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CATEGORIES, startScheduler, scanLoop, readCache } = require('./scanner');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function filterRepos(cache, { category, q, sort, limit }) {
  let repos = cache ? cache.repos : [];
  if (category && category !== 'all') {
    repos = repos.filter((r) => r.categories.includes(category));
  }
  if (q) {
    const needle = q.toLowerCase();
    repos = repos.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.topics.some((t) => t.toLowerCase().includes(needle))
    );
  }
  const sorted = [...repos];
  if (sort === 'updated') sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else sorted.sort((a, b) => b.stars - a.stars);
  const max = Math.min(Number(limit) || 200, 500);
  return sorted.slice(0, max);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/api/meta') {
    const cache = readCache();
    return sendJson(res, 200, {
      scannedAt: cache ? cache.scannedAt : null,
      scanStartedAt: cache ? cache.scanStartedAt : null,
      total: cache ? cache.count : 0,
      categories: cache
        ? cache.categories
        : CATEGORIES.map((c) => ({ ...c, count: 0 })),
      availableCategories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    });
  }

  if (pathname === '/api/skills') {
    const cache = readCache();
    const repos = filterRepos(cache || { repos: [] }, {
      category: url.searchParams.get('category') || 'all',
      q: url.searchParams.get('q') || '',
      sort: url.searchParams.get('sort') || 'stars',
      limit: url.searchParams.get('limit') || '200',
    });
    return sendJson(res, 200, {
      scannedAt: cache ? cache.scannedAt : null,
      count: repos.length,
      repos,
    });
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    scanLoop();
    return sendJson(res, 202, { started: true });
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Unknown API endpoint' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Free AI Skills running at http://${HOST}:${PORT}`);
  startScheduler();
});
