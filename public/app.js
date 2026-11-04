/* Free AI Skills — front-end logic */
(function () {
  'use strict';

  const state = { category: 'all', q: '', sort: 'stars' };
  let categories = [];
  let lastScannedAt = null;

  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('emptyState');
  const resultsMeta = document.getElementById('resultsMeta');
  const categoryBar = document.getElementById('categoryBar');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const scanText = document.getElementById('scanText');
  const pulseDot = document.getElementById('pulseDot');
  const refreshBtn = document.getElementById('refreshBtn');

  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8',
    Rust: '#dea584', Java: '#b07219', 'C++': '#f34b7d', C: '#555555', Ruby: '#701516',
    Swift: '#F05138', Kotlin: '#A97BFF', PHP: '#4F5D95', Shell: '#89e051',
    Jupyter: '#DA5B0B', HTML: '#e34c26', Vue: '#41b883', Dart: '#00B4AB', Scala: '#c22d40',
  };

  function fmtNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function timeAgo(iso) {
    if (!iso) return 'never';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderCategories(meta) {
    categories = meta.availableCategories || [];
    const counts = {};
    (meta.categories || []).forEach((c) => { counts[c.id] = c.count; });
    const chips = [{ id: 'all', name: 'All', icon: '🌐', count: meta.total }]
      .concat(categories.map((c) => ({ ...c, count: counts[c.id] || 0 })));
    categoryBar.innerHTML = chips.map((c) => `
      <button class="cat-chip ${state.category === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">
        <span>${c.icon}</span><span>${esc(c.name)}</span><span class="count">${c.count}</span>
      </button>`).join('');
    categoryBar.querySelectorAll('.cat-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.category = btn.dataset.cat;
        categoryBar.querySelectorAll('.cat-chip').forEach((b) => b.classList.toggle('active', b === btn));
        loadSkills();
      });
    });
  }

  function renderScanStatus(meta, scanning) {
    lastScannedAt = meta.scannedAt;
    pulseDot.classList.toggle('scanning', !!scanning || !meta.scannedAt);
    scanText.textContent = !meta.scannedAt
      ? 'First scan in progress…'
      : scanning
        ? 'Scanning GitHub…'
        : `Last scan ${timeAgo(meta.scannedAt)} · ${meta.total} repos tracked`;
  }

  function repoCard(r) {
    const catNames = {};
    categories.forEach((c) => { catNames[c.id] = c.name; });
    const color = LANG_COLORS[r.language] || '#8b949e';
    const tags = r.topics.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const badges = r.categories.map((c) => `<span class="cat-badge">${esc(catNames[c] || c)}</span>`).join('');
    return `
      <article class="card">
        <div class="card-title"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></div>
        <p class="card-desc">${esc(r.description || 'No description provided.')}</p>
        <div class="card-tags">${tags}</div>
        <div class="cat-badges">${badges}</div>
        <div class="card-stats">
          <span>⭐ ${fmtNum(r.stars)}</span>
          <span>🍴 ${fmtNum(r.forks)}</span>
          <span><span class="lang-dot" style="background:${color}"></span>${esc(r.language)}</span>
          <span>⚖️ ${esc(r.license)}</span>
          <span>🕒 ${timeAgo(r.updatedAt)}</span>
        </div>
        <a class="card-link" href="${esc(r.url)}" target="_blank" rel="noopener">View on GitHub →</a>
      </article>`;
  }

  async function loadSkills() {
    const params = new URLSearchParams({ category: state.category, q: state.q, sort: state.sort, limit: '300' });
    const res = await fetch('/api/skills?' + params.toString());
    const data = await res.json();
    grid.innerHTML = data.repos.map(repoCard).join('');
    emptyState.hidden = data.repos.length > 0;
    const catLabel = state.category === 'all' ? 'all categories' : (categories.find((c) => c.id === state.category) || {}).name;
    resultsMeta.textContent = `${data.count} repositories in ${catLabel}` +
      (state.q ? ` matching “${state.q}”` : '') +
      (data.scannedAt ? ` · data as of ${timeAgo(data.scannedAt)}` : '');
  }

  async function loadMeta() {
    try {
      const res = await fetch('/api/meta');
      const meta = await res.json();
      renderCategories(meta);
      renderScanStatus(meta, false);
    } catch (e) {
      scanText.textContent = 'Could not reach the scanner API';
    }
  }

  let debounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchInput.value.trim();
      loadSkills();
    }, 250);
  });

  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    loadSkills();
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    pulseDot.classList.add('scanning');
    scanText.textContent = 'Scanning GitHub…';
    try { await fetch('/api/refresh', { method: 'POST' }); } catch (e) { /* ignore */ }
    // Poll until a new scan completes.
    const prev = lastScannedAt;
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/meta');
        const meta = await res.json();
        if (meta.scannedAt && meta.scannedAt !== prev) {
          clearInterval(poll);
          refreshBtn.disabled = false;
          renderCategories(meta);
          renderScanStatus(meta, false);
          loadSkills();
        }
      } catch (e) { /* keep polling */ }
    }, 5000);
    setTimeout(() => { clearInterval(poll); refreshBtn.disabled = false; }, 180000);
  });

  // Initial load + periodic meta refresh so "last scan" stays live.
  loadMeta().then(loadSkills);
  setInterval(loadMeta, 60000);
})();
