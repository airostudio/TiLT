'use strict';

// ============================================================================
// Module: TableDB  —  IndexedDB wrapper for persisting user-uploaded tables
// ============================================================================

const TableDB = (() => {
  const DB_NAME    = 'tilt-tables';
  const DB_VERSION = 1;
  const STORE      = 'tables';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'name' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async function saveTable(file) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record = { name: file.name, size: file.size, lastModified: file.lastModified, file };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function getTables() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE, 'readonly');
      const store   = tx.objectStore(STORE);
      const req     = store.getAll();
      req.onsuccess = (e) => {
        db.close();
        resolve(e.target.result.map(r => ({ name: r.name, size: r.size, lastModified: r.lastModified })));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getTableFile(name) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE, 'readonly');
      const store   = tx.objectStore(STORE);
      const req     = store.get(name);
      req.onsuccess = (e) => {
        db.close();
        if (e.target.result) resolve(e.target.result.file);
        else reject(new Error(`Table not found: ${name}`));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteTable(name) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE, 'readwrite');
      const store   = tx.objectStore(STORE);
      const req     = store.delete(name);
      req.onsuccess = () => { db.close(); resolve(); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  return { saveTable, getTables, getTableFile, deleteTable };
})();

// ============================================================================
// Module: TableRegistry  —  server-driven game list fetched from tables.json
// ============================================================================

const TableRegistry = (() => {
  let _entries  = [];
  let _loaded   = false;
  let _promise  = null;

  /**
   * Fetch the registry from tables.json.
   * The file lives in web/ and is served by Vercel — update it via git push.
   * @returns {Promise<Array>}
   */
  async function load() {
    if (_loaded) return _entries;
    if (_promise) return _promise;

    _promise = (async () => {
      try {
        const res = await fetch('tables.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _entries = Array.isArray(data.entries) ? data.entries : [];
      } catch (err) {
        console.warn('[TiLT] Could not load tables.json, using empty registry:', err);
        _entries = [];
      }
      _loaded = true;
      return _entries;
    })();

    return _promise;
  }

  function getEntries() { return _entries; }

  /** Build the manufacturer list from loaded entries (deduplicated, sorted). */
  function getManufacturers() {
    const set = new Set(_entries.map(e => e.manufacturer));
    return [...set].sort();
  }

  return { load, getEntries, getManufacturers };
})();

// ============================================================================
// Module: WasmLoader  —  dynamically inserts tilt.js exactly once
// ============================================================================

const WasmLoader = (() => {
  let loadPromise = null;
  const progressListeners = [];

  function onProgress(cb) { progressListeners.push(cb); }

  function _emitProgress(pct, text) {
    progressListeners.forEach(cb => { try { cb(pct, text); } catch (_) {} });
  }

  function loadEngine() {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      _emitProgress(5, 'Downloading engine…');

      window.Module = {
        canvas: document.getElementById('canvas'),

        setStatus(text) {
          if (!text) return;
          const m = text.match(/\((\d+)\/(\d+)\)/);
          if (m) {
            const frac = parseInt(m[1], 10) / parseInt(m[2], 10);
            _emitProgress(10 + frac * 50, `Downloading… ${Math.round(frac * 100)}%`);
          } else if (text.toLowerCase().includes('compiling')) {
            _emitProgress(75, 'Compiling WASM…');
          } else if (text.toLowerCase().includes('running') || text.toLowerCase().includes('preparing')) {
            _emitProgress(88, 'Initialising…');
          } else {
            _emitProgress(80, text);
          }
        },

        onRuntimeInitialized() {
          console.log('[TiLT] WASM runtime ready');
          _emitProgress(100, 'Ready');
          resolve();
        },

        print(text)    { console.log('[TiLT]', text); },
        printErr(text) { console.warn('[TiLT ERR]', text); },

        onAbort(what) {
          console.error('[TiLT] Abort:', what);
          reject(new Error('WASM abort: ' + what));
        },

        INITIAL_MEMORY: 134217728,
      };

      const script   = document.createElement('script');
      script.src     = 'tilt.js';
      script.async   = true;
      script.onerror = () => reject(new Error('Failed to load tilt.js'));
      document.body.appendChild(script);
    });

    return loadPromise;
  }

  function isLoaded() {
    return loadPromise !== null && typeof window.Module !== 'undefined' &&
           typeof window.Module._tilt_load_table_js === 'function';
  }

  return { loadEngine, isLoaded, onProgress };
})();

// ============================================================================
// Module: GameController  —  launch / stop / fullscreen / audio
// ============================================================================

const GameController = (() => {
  let _audioEnabled = true;
  let _currentTable = null;

  function _readFileBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr   = new FileReader();
      fr.onload  = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  function _bufferToWasmFS(name, buf) {
    const dir  = '/tables';
    const path = `${dir}/${name}`;
    try { FS.mkdir(dir); } catch (_) {}
    FS.writeFile(path, new Uint8Array(buf));
    return path;
  }

  async function launch(file, displayName) {
    _currentTable = { name: displayName || file.name };
    UI.showLauncher(_currentTable.name);

    try {
      await WasmLoader.loadEngine();
      UI.setEngineStatus('Writing to virtual FS…', 90);
      const buf  = await _readFileBuffer(file);
      const path = _bufferToWasmFS(file.name, buf);
      UI.setEngineStatus('Loading table…', 95);
      Module.ccall('tilt_load_table_js', null, ['string'], [path]);
      UI.hideEngineLoading();
    } catch (err) {
      console.error('[TiLT] launch() failed:', err);
      UI.setEngineStatus('Error: ' + err.message, 0);
    }
  }

  function stop() {
    _currentTable = null;
    try {
      if (WasmLoader.isLoaded()) Module.ccall('tilt_unload_table', null, [], []);
    } catch (e) {
      console.warn('[TiLT] tilt_unload_table error:', e);
    }
    UI.hideLauncher();
  }

  function toggleFullscreen() {
    const el = document.getElementById('canvasContainer');
    if (!document.fullscreenElement) {
      el.requestFullscreen && el.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  }

  function toggleAudio() {
    _audioEnabled = !_audioEnabled;
    try {
      if (typeof AL !== 'undefined' && AL.currentCtx) {
        AL.currentCtx.gain.gain.value = _audioEnabled ? 1 : 0;
      }
    } catch (e) { console.warn('[TiLT] toggleAudio:', e); }
    return _audioEnabled;
  }

  function isAudioEnabled() { return _audioEnabled; }

  return { launch, stop, toggleFullscreen, toggleAudio, isAudioEnabled };
})();

// ============================================================================
// Placeholder screenshot generator
// Each table gets a unique 80s-style SVG arcade screen when no image is found.
// ============================================================================

const NEON_PALETTES = [
  { bg: '#0a0028', primary: '#ff00ff', secondary: '#00ffff', grid: '#ff00ff' },
  { bg: '#001a00', primary: '#00ff88', secondary: '#ffff00', grid: '#00ff88' },
  { bg: '#1a0000', primary: '#ff4400', secondary: '#ff00cc', grid: '#ff4400' },
  { bg: '#00101a', primary: '#00e5ff', secondary: '#aa00ff', grid: '#00e5ff' },
  { bg: '#0f0a00', primary: '#ffe600', secondary: '#ff6600', grid: '#ffe600' },
  { bg: '#10001a', primary: '#cc00ff', secondary: '#ff0088', grid: '#cc00ff' },
  { bg: '#001410', primary: '#00ffcc', secondary: '#0088ff', grid: '#00ffcc' },
  { bg: '#1a0a00', primary: '#ff8800', secondary: '#ffff00', grid: '#ff8800' },
];

function _generatePlaceholder(name, idx, type) {
  const p = NEON_PALETTES[idx % NEON_PALETTES.length];

  // Shorten name for display
  const words = name.toUpperCase().split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 12) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line.trim());
  const displayLines = lines.slice(0, 4);

  // Build perspective grid (vanishing point at top-center)
  const vx = 100, vy = 60;
  let gridSvg = '';

  // Horizontal lines (floor grid)
  for (let i = 1; i <= 7; i++) {
    const t  = i / 7;
    const y  = 160 + t * 120;
    const hw = 20 + t * 80;
    const op = (0.12 + t * 0.2).toFixed(2);
    gridSvg += `<line x1="${100 - hw}" y1="${y}" x2="${100 + hw}" y2="${y}" stroke="${p.grid}" stroke-width="0.6" opacity="${op}"/>`;
  }

  // Vertical convergence lines
  for (let i = -4; i <= 4; i++) {
    const ex = 100 + i * 24;
    const ey = 280;
    const op = (0.1 + Math.abs(i) * 0.03).toFixed(2);
    gridSvg += `<line x1="${vx}" y1="${vy}" x2="${ex}" y2="${ey}" stroke="${p.grid}" stroke-width="0.5" opacity="${op}"/>`;
  }

  // Horizon glow
  gridSvg += `<line x1="10" y1="160" x2="190" y2="160" stroke="${p.primary}" stroke-width="1" opacity="0.5"/>`;
  gridSvg += `<ellipse cx="100" cy="160" rx="90" ry="6" fill="${p.primary}" opacity="0.04"/>`;

  // Stars
  const starCoords = [[25,20],[75,12],[140,25],[165,15],[50,45],[155,40],[10,55],[180,50]];
  for (const [sx, sy] of starCoords) {
    gridSvg += `<circle cx="${sx}" cy="${sy}" r="0.8" fill="white" opacity="0.7"/>`;
  }

  // Text lines (centered, 80s pixel style)
  const lineH   = 14;
  const totalH  = displayLines.length * lineH;
  const startY  = 105 - totalH / 2;
  let textSvg   = '';
  for (let i = 0; i < displayLines.length; i++) {
    const y = startY + i * lineH;
    textSvg += `
      <text x="100" y="${y}" text-anchor="middle"
            font-family="'Courier New',monospace" font-size="9"
            font-weight="bold" fill="${p.primary}"
            paint-order="stroke" stroke="${p.bg}" stroke-width="3"
            filter="url(#glow)">${displayLines[i]}</text>`;
  }

  // Type label
  const typeLine = type === 'arcade' ? '◆ ARCADE ◆' : '● PINBALL ●';
  textSvg += `
    <text x="100" y="130" text-anchor="middle"
          font-family="'Courier New',monospace" font-size="6"
          fill="${p.secondary}" letter-spacing="2" opacity="0.9">${typeLine}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
  <defs>
    <linearGradient id="bg${idx}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.bg}"/>
      <stop offset="60%" stop-color="#000010"/>
      <stop offset="100%" stop-color="#000005"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="200" height="300" fill="url(#bg${idx})"/>
  ${gridSvg}
  ${textSvg}
  <rect width="200" height="300" fill="none" stroke="${p.primary}" stroke-width="1.5" opacity="0.25"/>
</svg>`;

  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// ============================================================================
// Module: UI  —  DOM manipulation helpers
// ============================================================================

const UI = (() => {

  // ── Launcher ───────────────────────────────────────────────────────────────

  function showLauncher(tableName) {
    const launcher = document.getElementById('launcher');
    launcher.classList.remove('hidden');
    document.getElementById('launcherTitle').textContent = tableName || 'Playing…';
    document.body.style.overflow = 'hidden';

    const overlay = document.getElementById('engineLoading');
    overlay.classList.remove('hidden');
    overlay.classList.remove('fade-out');
    setEngineStatus('Downloading engine…', 5);

    WasmLoader.onProgress((pct, text) => setEngineStatus(text, pct));
  }

  function hideLauncher() {
    document.getElementById('launcher').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('engineLoading').classList.remove('hidden');
    document.getElementById('engineLoading').classList.remove('fade-out');
  }

  function setEngineStatus(text, pct) {
    const el   = document.getElementById('engineStatus');
    const fill = document.getElementById('engineProgressFill');
    if (el)   el.textContent   = text || '';
    if (fill) fill.style.width = Math.min(100, pct || 0) + '%';
  }

  function hideEngineLoading() {
    setEngineStatus('Ready', 100);
    setTimeout(() => {
      const el = document.getElementById('engineLoading');
      if (el) el.classList.add('fade-out');
      setTimeout(() => { if (el) el.classList.add('hidden'); }, 400);
    }, 300);
  }

  // ── Library grid ───────────────────────────────────────────────────────────

  /**
   * Render the registry game grid.
   * @param {Array}  entries       All entries from TableRegistry
   * @param {string} query         Search query
   * @param {string} manufacturer  Manufacturer filter
   * @param {string} typeFilter    'all' | 'pinball' | 'arcade'
   */
  function renderLibrary(entries, query, manufacturer, typeFilter) {
    const grid  = document.getElementById('tableGrid');
    const stats = document.getElementById('tableStats');
    if (!grid) return;

    const q = (query || '').toLowerCase();
    const m = manufacturer || '';
    const t = typeFilter   || 'all';

    const filtered = entries.filter(e => {
      const matchQ = !q || e.name.toLowerCase().includes(q) || (e.manufacturer || '').toLowerCase().includes(q);
      const matchM = !m || e.manufacturer === m;
      const matchT = t === 'all' || e.type === t;
      return matchQ && matchM && matchT;
    });

    stats.textContent = (q || m || t !== 'all')
      ? `${filtered.length} of ${entries.length} games`
      : `${entries.length} games in registry`;

    grid.innerHTML = '';

    if (!filtered.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:40px 20px;text-align:center;font-family:var(--font-pixel);font-size:9px;color:var(--text-dim);letter-spacing:0.1em">NO GAMES FOUND</div>`;
      return;
    }

    filtered.forEach((entry, i) => {
      // Map back to original index for consistent palette
      const globalIdx = entries.indexOf(entry);
      grid.appendChild(_buildRegistryCard(entry, globalIdx));
    });
  }

  /**
   * Build a card for a registry entry (pinball or arcade), with screenshot image.
   */
  function _buildRegistryCard(entry, idx) {
    const isArcade = entry.type === 'arcade';
    const placeholder = _generatePlaceholder(entry.name, idx, entry.type || 'pinball');

    const card = document.createElement('div');
    card.className = 'table-card' + (isArcade ? ' arcade-card' : '');
    card.setAttribute('role', 'listitem');

    // ── Thumbnail ──────────────────────────────────────────────────────────
    const thumb = document.createElement('div');
    thumb.className = 'card-thumb';

    const img = document.createElement('img');
    img.alt     = entry.name;
    img.loading = 'lazy';
    img.decoding = 'async';

    // Try the real screenshot; fall back to generated SVG placeholder.
    if (entry.screenshot) {
      img.src     = entry.screenshot;
      img.onerror = () => {
        img.onerror = null;
        img.src = placeholder;
      };
    } else {
      img.src = placeholder;
    }

    thumb.appendChild(img);

    // Badge (type badge always shown; named badge optional)
    if (entry.badge) {
      const namedBadge = document.createElement('span');
      namedBadge.className = 'card-badge ' + (isArcade ? 'card-badge-arcade' : 'card-badge-pinball');
      namedBadge.textContent = entry.badge;
      thumb.appendChild(namedBadge);
    }

    // ── Body ───────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('div');
    name.className   = 'card-name';
    name.textContent = entry.name;

    const meta = document.createElement('div');
    meta.className   = 'card-meta';
    meta.textContent = `${entry.manufacturer} · ${entry.year}`;

    const rating = document.createElement('div');
    rating.className   = 'card-rating';
    const stars = Math.round(entry.rating || 0);
    rating.textContent = '★'.repeat(stars) + '☆'.repeat(Math.max(0, 5 - stars)) + `  ${(entry.rating || 0).toFixed(1)}`;

    body.append(name, meta, rating);

    // ── Actions ────────────────────────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const playBtn = document.createElement('button');
    playBtn.className  = 'btn btn-primary';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _showComingSoon(entry.name);
    });

    actions.appendChild(playBtn);
    card.append(thumb, body, actions);
    card.addEventListener('click', () => _showComingSoon(entry.name));
    return card;
  }

  /**
   * Render user-uploaded tables from IndexedDB.
   */
  function renderUserLibrary(tables) {
    const label = document.getElementById('userTablesLabel');
    const grid  = document.getElementById('userGrid');
    if (!grid) return;

    if (!tables.length) {
      label.style.display = 'none';
      grid.innerHTML = '';
      return;
    }

    label.style.display = '';
    grid.innerHTML = '';
    tables.forEach((t, i) => grid.appendChild(_buildUserCard(t, i)));
  }

  function _buildUserCard(meta, idx) {
    const ext         = (meta.name.split('.').pop() || '').toLowerCase();
    const displayName = meta.name.replace(/\.[^.]+$/, '');
    const placeholder = _generatePlaceholder(displayName, idx + 50, 'pinball');

    const card = document.createElement('div');
    card.className = 'table-card user-card';
    card.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    thumb.className = 'card-thumb';

    const img = document.createElement('img');
    img.src     = placeholder;
    img.alt     = displayName;
    img.loading = 'lazy';
    thumb.appendChild(img);

    const badge = document.createElement('span');
    badge.className   = 'card-badge card-badge-user';
    badge.textContent = ext.toUpperCase();
    thumb.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('div');
    name.className   = 'card-name';
    name.textContent = displayName;

    const sizeMB = (meta.size / 1024 / 1024).toFixed(1);
    const date   = new Date(meta.lastModified).toLocaleDateString();

    const metaEl = document.createElement('div');
    metaEl.className   = 'card-meta';
    metaEl.textContent = `${sizeMB} MB · ${date}`;

    body.append(name, metaEl);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const playBtn = document.createElement('button');
    playBtn.className  = 'btn btn-primary';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const file = await TableDB.getTableFile(meta.name);
        GameController.launch(file, displayName);
      } catch (err) {
        console.error('[TiLT] Could not retrieve table from IDB:', err);
        alert('Could not load the table file. It may have been removed from local storage.');
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.title     = 'Delete from local storage';
    delBtn.setAttribute('aria-label', `Delete ${meta.name}`);
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${meta.name}" from local storage?`)) return;
      await TableDB.deleteTable(meta.name);
      const updated = await TableDB.getTables();
      UI.renderUserLibrary(updated);
    });

    actions.append(playBtn, delBtn);
    card.append(thumb, body, actions);
    return card;
  }

  // ── Coming-soon modal ──────────────────────────────────────────────────────

  function _showComingSoon(tableName) {
    document.getElementById('csmTableName').textContent = `"${tableName}"`;
    document.getElementById('comingSoonModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('csmCloseBtn').focus();
  }

  // ── Section navigation ─────────────────────────────────────────────────────

  function activateSection(id) {
    document.querySelectorAll('.spa-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab[data-section]').forEach(b => {
      b.classList.toggle('active', b.dataset.section === id);
      b.setAttribute('aria-current', b.dataset.section === id ? 'page' : 'false');
    });
    const target = document.getElementById(`section-${id}`);
    if (target) target.classList.add('active');
  }

  return {
    showLauncher, hideLauncher,
    setEngineStatus, hideEngineLoading,
    renderLibrary, renderUserLibrary,
    activateSection,
  };
})();

// ============================================================================
// State
// ============================================================================

const state = {
  search:       '',
  manufacturer: '',
  typeFilter:   'all',
  userTables:   [],
  entries:      [],
};

// ============================================================================
// Upload handling
// ============================================================================

const ALLOWED_EXT = new Set(['vpx', 'fpt', 'vpt', 'zip']);

function extOf(name)       { return (name.split('.').pop() || '').toLowerCase(); }
function isTableFile(name) { return ALLOWED_EXT.has(extOf(name)); }
function formatBytes(b)    { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }

async function handleFiles(fileList) {
  const queue = document.getElementById('uploadQueue');
  const files = Array.from(fileList).filter(f => isTableFile(f.name));

  if (!files.length) {
    alert('No supported table files found. Please upload .vpx, .fpt, .vpt, or .zip files.');
    return;
  }

  for (const file of files) {
    const li = document.createElement('li');
    li.className = 'upload-item';
    li.innerHTML = `
      <span class="upload-item-name">${file.name}</span>
      <span class="upload-item-size">${formatBytes(file.size)}</span>
      <span class="upload-item-status pending">Saving…</span>
    `;
    queue.prepend(li);
    const statusEl = li.querySelector('.upload-item-status');

    try {
      await TableDB.saveTable(file);
      statusEl.textContent = 'Saved';
      statusEl.className   = 'upload-item-status ok';
    } catch (err) {
      console.error('[TiLT] saveTable failed:', err);
      statusEl.textContent = 'Failed';
      statusEl.className   = 'upload-item-status error';
    }
  }

  state.userTables = await TableDB.getTables();
  UI.renderUserLibrary(state.userTables);
}

// ============================================================================
// Event wiring
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {

  // ── Navigation tabs ─────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-tab[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.activateSection(btn.dataset.section));
  });

  // ── Type filter buttons ─────────────────────────────────────────────────────
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.typeFilter = btn.dataset.type || 'all';
      UI.renderLibrary(state.entries, state.search, state.manufacturer, state.typeFilter);
    });
  });

  // ── Search / manufacturer filter ─────────────────────────────────────────────
  const searchInput        = document.getElementById('searchInput');
  const filterManufacturer = document.getElementById('filterManufacturer');

  function applyFilter() {
    UI.renderLibrary(state.entries, state.search, state.manufacturer, state.typeFilter);
  }

  searchInput?.addEventListener('input', e => { state.search = e.target.value; applyFilter(); });

  filterManufacturer?.addEventListener('change', e => { state.manufacturer = e.target.value; applyFilter(); });

  // ── Launcher controls ───────────────────────────────────────────────────────
  document.getElementById('btnBack')?.addEventListener('click', () => {
    if (confirm('Stop the current game and return to the library?')) GameController.stop();
  });

  document.getElementById('btnFullscreen')?.addEventListener('click', () => {
    GameController.toggleFullscreen();
  });

  document.getElementById('btnAudio')?.addEventListener('click', () => {
    const enabled = GameController.toggleAudio();
    const btn     = document.getElementById('btnAudio');
    const icon    = document.getElementById('audioIcon');
    btn.setAttribute('aria-pressed', String(enabled));
    if (enabled) {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>`;
    } else {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <line x1="23" y1="9" x2="17" y2="15"/>
                        <line x1="17" y1="9" x2="23" y2="15"/>`;
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const isFS = !!document.fullscreenElement;
    const icon = document.getElementById('fullscreenIcon');
    if (!icon) return;
    if (isFS) {
      icon.innerHTML = `<polyline points="4 14 10 14 10 20"/>
                        <polyline points="20 10 14 10 14 4"/>
                        <line x1="10" y1="14" x2="3" y2="21"/>
                        <line x1="21" y1="3" x2="14" y2="10"/>`;
    } else {
      icon.innerHTML = `<polyline points="15 3 21 3 21 9"/>
                        <polyline points="9 21 3 21 3 15"/>
                        <line x1="21" y1="3" x2="14" y2="10"/>
                        <line x1="3" y1="21" x2="10" y2="14"/>`;
    }
  });

  // ── Upload zone ─────────────────────────────────────────────────────────────
  const uploadZone = document.getElementById('uploadZone');
  const fileInput  = document.getElementById('fileInput');
  const pickBtn    = document.getElementById('uploadPickBtn');

  pickBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', e => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  });

  let dragDepth = 0;
  document.addEventListener('dragenter',  e => { e.preventDefault(); dragDepth++; uploadZone?.classList.add('drag-over'); });
  document.addEventListener('dragleave',  () => { dragDepth--; if (dragDepth <= 0) { dragDepth = 0; uploadZone?.classList.remove('drag-over'); } });
  document.addEventListener('dragover',   e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    uploadZone?.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files?.length) { UI.activateSection('upload'); handleFiles(files); }
  });

  // ── Coming-soon modal ───────────────────────────────────────────────────────
  document.getElementById('csmBackdrop')?.addEventListener('click', () => {
    document.getElementById('comingSoonModal').classList.add('hidden');
    document.body.style.overflow = '';
  });
  document.getElementById('csmCloseBtn')?.addEventListener('click', () => {
    document.getElementById('comingSoonModal').classList.add('hidden');
    document.body.style.overflow = '';
  });
  document.getElementById('csmUploadBtn')?.addEventListener('click', () => {
    document.getElementById('comingSoonModal').classList.add('hidden');
    document.body.style.overflow = '';
    UI.activateSection('upload');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('comingSoonModal')?.classList.add('hidden');
      document.body.style.overflow = '';
    }
  });

  // ── Load registry & initial render ──────────────────────────────────────────
  const grid  = document.getElementById('tableGrid');
  const stats = document.getElementById('tableStats');

  // Show loading state
  if (grid)  grid.innerHTML  = `<div class="registry-loading" style="grid-column:1/-1">Loading registry…</div>`;
  if (stats) stats.textContent = 'Loading…';

  try {
    state.entries = await TableRegistry.load();

    // Populate manufacturer filter
    const manufacturers = TableRegistry.getManufacturers();
    manufacturers.forEach(m => {
      const opt = document.createElement('option');
      opt.value       = m;
      opt.textContent = m;
      filterManufacturer?.appendChild(opt);
    });

    UI.renderLibrary(state.entries, '', '', 'all');
  } catch (e) {
    console.error('[TiLT] Registry load error:', e);
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;font-family:var(--font-pixel);font-size:9px;color:var(--red)">REGISTRY ERROR</div>`;
  }

  try {
    state.userTables = await TableDB.getTables();
    UI.renderUserLibrary(state.userTables);
  } catch (e) {
    console.warn('[TiLT] Could not load user tables from IndexedDB:', e);
  }
});
