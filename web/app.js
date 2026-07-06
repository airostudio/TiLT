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
// Module: RepositoryBrowser  —  on-demand game download from Internet Archive
// ============================================================================

const RepositoryBrowser = (() => {
  const IA_SEARCH = 'https://archive.org/advancedsearch.php';
  const IA_META   = 'https://archive.org/metadata';
  const IA_DL     = 'https://archive.org/download';

  // Kept in sync with ALLOWED_EXT (upload validation): everything saved to
  // the library gets a Play button, so only offer formats the engine and the
  // upload path both accept.
  const GAME_EXTS = ['.vpx', '.vpt', '.fpt', '.zip'];

  // Curated starting points — all freely distributable content.
  const PRESETS = [
    {
      label: 'Epic Pinball',
      id:    'epicpinballcompletecollection',
      type:  'item',
      desc:  '10 classic 80s tables — fully freeware',
    },
    {
      label: 'Visual Pinball 2020',
      id:    'Visual_Pinball_2020-06-20',
      type:  'item',
      desc:  'Community VPX collection (222 GB)',
    },
    {
      label: 'FreeWPC ROMs',
      id:    'freewpc',
      type:  'search',
      desc:  'GPL-licensed WPC machine ROMs',
    },
    {
      label: 'Pinball on Archive',
      id:    'pinball AND mediatype:software',
      type:  'search',
      desc:  'All pinball software on Archive.org',
    },
  ];

  function _isGameFile(name) {
    const lower = name.toLowerCase();
    return GAME_EXTS.some(ext => lower.endsWith(ext));
  }

  async function search(query, signal) {
    const url = `${IA_SEARCH}?q=${encodeURIComponent(query)}`
              + `&fl[]=identifier&fl[]=title&fl[]=description&fl[]=item_size`
              + `&rows=24&output=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.response?.docs ?? [];
  }

  async function listFiles(itemId) {
    const res = await fetch(`${IA_META}/${encodeURIComponent(itemId)}/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.result ?? [])
      .filter(f => f.name && !f.name.startsWith('_') && _isGameFile(f.name))
      .map(f => ({ name: f.name, size: parseInt(f.size ?? '0', 10) || 0 }));
  }

  async function downloadFile(itemId, filename, onProgress) {
    // Archive.org file names routinely contain subdirectories — encode each
    // path segment but keep the '/' separators intact.
    const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    const url = `${IA_DL}/${encodeURIComponent(itemId)}/${encodedPath}`;
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total  = parseInt(res.headers.get('content-length') ?? '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received, total);
    }

    const blob = new Blob(chunks);
    return new File([blob], filename, { type: 'application/octet-stream' });
  }

  return { search, listFiles, downloadFile, PRESETS };
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
      const res = await fetch('tables.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _entries = Array.isArray(data.entries) ? data.entries : [];
      _loaded = true;
      return _entries;
    })().catch(err => {
      // Propagate so the caller can render an error state, and clear the
      // cached promise so a reload/retry can attempt the fetch again.
      _promise = null;
      throw err;
    });

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
      };

      const script   = document.createElement('script');
      script.src     = 'tilt.js';
      script.async   = true;
      script.onerror = () => reject(new Error('Failed to load tilt.js'));
      document.body.appendChild(script);
    });

    // A failed load must not be cached forever — clear it so the next Play
    // click re-injects the script instead of instantly re-rejecting.
    loadPromise = loadPromise.catch(err => {
      loadPromise = null;
      throw err;
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

const _placeholderCache = new Map();

function _generatePlaceholder(name, idx, type) {
  const cacheKey = `${name}|${idx % NEON_PALETTES.length}|${type}`;
  const cached = _placeholderCache.get(cacheKey);
  if (cached) return cached;

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

  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  _placeholderCache.set(cacheKey, uri);
  return uri;
}

// ============================================================================
// Module: UI  —  DOM manipulation helpers
// ============================================================================

const UI = (() => {

  // Build a full-width status line for a grid (loading / error / empty).
  // Uses textContent so server-derived text can never inject markup.
  function _gridMessage(grid, text, colorVar = '--text-dim') {
    const div = document.createElement('div');
    div.style.cssText = `grid-column:1/-1;padding:40px 20px;text-align:center;font-family:var(--font-pixel);font-size:9px;letter-spacing:0.1em;color:var(${colorVar})`;
    div.textContent = text;
    grid.replaceChildren(div);
  }

  // ── Launcher ───────────────────────────────────────────────────────────────

  let _progressWired = false;
  let _launcherReturnFocus = null;

  function showLauncher(tableName) {
    const launcher = document.getElementById('launcher');
    launcher.classList.remove('hidden');
    document.getElementById('launcherTitle').textContent = tableName || 'Playing…';
    document.body.style.overflow = 'hidden';

    const overlay = document.getElementById('engineLoading');
    overlay.classList.remove('hidden');
    overlay.classList.remove('fade-out');
    setEngineStatus('Downloading engine…', 5);

    // Register the progress listener exactly once — WasmLoader keeps
    // listeners for the page lifetime, so re-registering per launch leaks.
    if (!_progressWired) {
      _progressWired = true;
      WasmLoader.onProgress((pct, text) => setEngineStatus(text, pct));
    }

    // Move keyboard focus into the dialog so Tab doesn't land on the
    // library hidden behind the full-screen overlay.
    _launcherReturnFocus = document.activeElement;
    document.getElementById('btnBack')?.focus();
  }

  function hideLauncher() {
    document.getElementById('launcher').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('engineLoading').classList.remove('hidden');
    document.getElementById('engineLoading').classList.remove('fade-out');
    _launcherReturnFocus?.focus?.();
    _launcherReturnFocus = null;
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

    // Carry the original index through the filter so each card keeps a
    // stable palette without an O(n²) indexOf per render.
    const filtered = entries
      .map((entry, globalIdx) => ({ entry, globalIdx }))
      .filter(({ entry: e }) => {
        const matchQ = !q || e.name.toLowerCase().includes(q) || (e.manufacturer || '').toLowerCase().includes(q);
        const matchM = !m || e.manufacturer === m;
        const matchT = t === 'all' || e.type === t;
        return matchQ && matchM && matchT;
      });

    stats.textContent = (q || m || t !== 'all')
      ? `${filtered.length} of ${entries.length} games`
      : `${entries.length} games in registry`;

    if (!filtered.length) {
      _gridMessage(grid, 'NO GAMES FOUND');
      return;
    }

    grid.replaceChildren(
      ...filtered.map(({ entry, globalIdx }) => _buildRegistryCard(entry, globalIdx))
    );
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
        Dialog.show({
          title: 'Table Unavailable',
          message: 'Could not load the table file. It may have been removed from local storage.',
        });
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-secondary';
    delBtn.title     = 'Delete from local storage';
    delBtn.setAttribute('aria-label', `Delete ${meta.name}`);
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await Dialog.show({
        title: 'Delete Table?',
        message: `Delete "${meta.name}" from local storage?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
      });
      if (!ok) return;
      await TableDB.deleteTable(meta.name);
      const updated = await TableDB.getTables();
      state.userTables = updated;
      UI.renderUserLibrary(updated);
    });

    actions.append(playBtn, delBtn);
    card.append(thumb, body, actions);
    return card;
  }

  // ── Coming-soon modal ──────────────────────────────────────────────────────

  let _csmReturnFocus = null;

  function _showComingSoon(tableName) {
    _csmReturnFocus = document.activeElement;
    document.getElementById('csmTableName').textContent = `"${tableName}"`;
    document.getElementById('comingSoonModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('csmCloseBtn').focus();
  }

  function closeComingSoon() {
    const modal = document.getElementById('comingSoonModal');
    if (!modal || modal.classList.contains('hidden')) return false;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    _csmReturnFocus?.focus?.();
    _csmReturnFocus = null;
    return true;
  }

  // ── Section navigation ─────────────────────────────────────────────────────

  function activateSection(id) {
    document.querySelectorAll('.spa-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab[data-section]').forEach(b => {
      const isActive = b.dataset.section === id;
      b.classList.toggle('active', isActive);
      if (isActive) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const target = document.getElementById(`section-${id}`);
    if (target) target.classList.add('active');
  }

  // ── Repository browser ─────────────────────────────────────────────────────

  function renderRepoPresets(presets) {
    const container = document.getElementById('repoPresets');
    if (!container) return;
    container.innerHTML = '';
    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.dataset.id   = p.id;
      btn.dataset.type = p.type;
      btn.innerHTML = `<span class="preset-label">${p.label}</span><span class="preset-desc">${p.desc}</span>`;
      container.appendChild(btn);
    });
  }

  function renderRepoResults(docs) {
    const grid  = document.getElementById('repoGrid');
    const stats = document.getElementById('repoStats');
    const back  = document.getElementById('repoBackBtn');
    if (!grid) return;

    // Remember the result set so Back (from a file listing) can restore it.
    state.repoDocs = docs;

    back?.classList.add('hidden');
    if (stats) stats.textContent = `${docs.length} result${docs.length !== 1 ? 's' : ''} from Internet Archive`;

    if (!docs.length) {
      _gridMessage(grid, 'NO RESULTS');
      return;
    }
    grid.innerHTML = '';

    docs.forEach((doc, i) => {
      const card = document.createElement('div');
      card.className = 'table-card repo-result-card';
      card.setAttribute('role', 'listitem');

      const placeholder = _generatePlaceholder(doc.title || doc.identifier, i, 'pinball');

      const thumb = document.createElement('div');
      thumb.className = 'card-thumb';
      const img = document.createElement('img');
      img.src     = placeholder;
      img.alt     = doc.title || doc.identifier;
      img.loading = 'lazy';
      thumb.appendChild(img);

      const badge = document.createElement('span');
      badge.className   = 'card-badge card-badge-repo';
      badge.textContent = 'ARCHIVE';
      thumb.appendChild(badge);

      const body = document.createElement('div');
      body.className = 'card-body';

      const name = document.createElement('div');
      name.className   = 'card-name';
      name.textContent = doc.title || doc.identifier;

      const desc = document.createElement('div');
      desc.className   = 'card-meta repo-desc';
      const raw = (doc.description || '').replace(/<[^>]+>/g, '');
      desc.textContent = raw.length > 90 ? raw.slice(0, 87) + '…' : raw;

      const size = document.createElement('div');
      size.className   = 'card-meta';
      size.textContent = doc.item_size ? formatBytes(doc.item_size) : '';

      body.append(name, desc, size);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const browseBtn = document.createElement('button');
      browseBtn.className   = 'btn btn-primary';
      browseBtn.textContent = 'Browse Files';
      browseBtn.addEventListener('click', e => {
        e.stopPropagation();
        browseBtn.textContent = 'Loading…';
        browseBtn.disabled    = true;
        UI.loadRepoFiles(doc.identifier, doc.title || doc.identifier);
      });

      actions.appendChild(browseBtn);
      card.append(thumb, body, actions);
      grid.appendChild(card);
    });
  }

  async function _loadRepoFiles(itemId, itemTitle) {
    const grid  = document.getElementById('repoGrid');
    const stats = document.getElementById('repoStats');
    const back  = document.getElementById('repoBackBtn');
    const presetsLabel = document.getElementById('repoPresetsLabel');
    const presets      = document.getElementById('repoPresets');

    if (grid)  _gridMessage(grid, 'LOADING FILES…', '--cyan');
    if (stats) stats.textContent = '';

    try {
      const files = await RepositoryBrowser.listFiles(itemId);

      presetsLabel?.classList.add('hidden');
      presets?.classList.add('hidden');
      back?.classList.remove('hidden');

      if (stats) stats.textContent = `${files.length} game file${files.length !== 1 ? 's' : ''} in "${itemTitle}"`;

      if (!files.length) {
        _gridMessage(grid, 'NO GAME FILES FOUND');
        return;
      }
      grid.innerHTML = '';

      files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'repo-file-row';
        row.setAttribute('role', 'listitem');

        const info = document.createElement('div');
        info.className = 'repo-file-info';

        const fname = document.createElement('span');
        fname.className   = 'repo-file-name';
        fname.textContent = f.name;

        const fsize = document.createElement('span');
        fsize.className   = 'repo-file-size';
        fsize.textContent = f.size ? formatBytes(f.size) : '';

        info.append(fname, fsize);

        const progress = document.createElement('div');
        progress.className = 'repo-file-progress hidden';
        progress.innerHTML = `<div class="repo-progress-track"><div class="repo-progress-fill"></div></div><span class="repo-progress-text">0%</span>`;

        const dlBtn = document.createElement('button');
        dlBtn.className   = 'btn btn-primary';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', async () => {
          dlBtn.disabled    = true;
          dlBtn.textContent = 'Downloading…';
          progress.classList.remove('hidden');

          try {
            const file = await RepositoryBrowser.downloadFile(itemId, f.name, (received, total) => {
              const pct  = total ? Math.round(received * 100 / total) : 0;
              const fill = progress.querySelector('.repo-progress-fill');
              const text = progress.querySelector('.repo-progress-text');
              if (fill) fill.style.width = pct + '%';
              if (text) text.textContent = total
                ? `${formatBytes(received)} / ${formatBytes(total)}`
                : formatBytes(received);
            });

            await TableDB.saveTable(file);

            dlBtn.textContent = '✓ Saved';
            dlBtn.className   = 'btn btn-secondary';
            progress.classList.add('hidden');

            // Refresh user library so the download appears immediately
            const updated = await TableDB.getTables();
            UI.renderUserLibrary(updated);
            state.userTables = updated;

          } catch (err) {
            console.error('[TiLT] Download failed:', err);
            dlBtn.disabled    = false;
            dlBtn.textContent = 'Retry';
            progress.classList.add('hidden');
            const text = progress.querySelector('.repo-progress-text');
            if (text) text.textContent = '';

            // A CORS-blocked fetch throws a TypeError with browser-specific
            // wording ("Failed to fetch" / "NetworkError…"), so key off the
            // error type instead of matching Chrome's message.
            const errEl = document.createElement('span');
            errEl.className   = 'repo-file-error';
            errEl.textContent = (err instanceof TypeError)
              ? 'Download blocked (CORS) — grab the file from archive.org and add it via the Upload tab'
              : `Error: ${err.message}`;
            row.querySelector('.repo-file-error')?.remove();
            row.appendChild(errEl);
          }
        });

        row.append(info, progress, dlBtn);
        grid.appendChild(row);
      });

    } catch (err) {
      if (grid) _gridMessage(grid, `ERROR: ${err.message}`, '--red');
      // Don't strand the user on an empty screen — bring Back into view so
      // they can return to the results/presets.
      back?.classList.remove('hidden');
    }
  }

  return {
    showLauncher, hideLauncher,
    setEngineStatus, hideEngineLoading,
    renderLibrary, renderUserLibrary,
    renderRepoPresets, renderRepoResults,
    loadRepoFiles: _loadRepoFiles,
    gridMessage: _gridMessage,
    activateSection, closeComingSoon,
  };
})();

// ============================================================================
// Module: Dialog  —  styled in-app confirm/alert (replaces native dialogs)
// ============================================================================

const Dialog = (() => {
  let _resolve   = null;
  let _lastFocus = null;

  const _el = id => document.getElementById(id);

  function _close(result) {
    _el('confirmModal').classList.add('hidden');
    document.body.style.overflow = '';
    _lastFocus?.focus?.();
    _lastFocus = null;
    const r = _resolve;
    _resolve = null;
    r?.(result);
  }

  /**
   * Show a modal dialog. Resolves true on confirm, false on cancel/dismiss.
   * Omit cancelText for a single-button alert.
   */
  function show({ title, message, confirmText = 'OK', cancelText = null }) {
    return new Promise(resolve => {
      _resolve   = resolve;
      _lastFocus = document.activeElement;

      _el('cfmTitle').textContent      = title;
      _el('cfmMessage').textContent    = message;
      _el('cfmConfirmBtn').textContent = confirmText;

      const cancelBtn = _el('cfmCancelBtn');
      cancelBtn.textContent = cancelText || '';
      cancelBtn.classList.toggle('hidden', !cancelText);

      _el('confirmModal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      _el('cfmConfirmBtn').focus();
    });
  }

  function isOpen() { return _resolve !== null; }

  function wire() {
    _el('cfmConfirmBtn')?.addEventListener('click', () => _close(true));
    _el('cfmCancelBtn')?.addEventListener('click', () => _close(false));
    _el('cfmBackdrop')?.addEventListener('click', () => _close(false));

    _el('confirmModal')?.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        _close(false);
      } else if (e.key === 'Tab') {
        // Trap focus between the two dialog buttons.
        const buttons = [_el('cfmConfirmBtn'), _el('cfmCancelBtn')]
          .filter(b => b && !b.classList.contains('hidden'));
        if (buttons.length < 2) { e.preventDefault(); return; }
        const [first, last] = [buttons[0], buttons[buttons.length - 1]];
        if (e.shiftKey && document.activeElement === first)      { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  return { show, wire, isOpen };
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
  repoDocs:     [],   // last Browse-tab search results (for Back navigation)
};

// ============================================================================
// Upload handling
// ============================================================================

const ALLOWED_EXT = new Set(['vpx', 'fpt', 'vpt', 'zip']);

function extOf(name)       { return (name.split('.').pop() || '').toLowerCase(); }
function isTableFile(name) { return ALLOWED_EXT.has(extOf(name)); }

function formatBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576)    return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1024).toFixed(1) + ' KB';
}

async function handleFiles(fileList) {
  const queue = document.getElementById('uploadQueue');
  const files = Array.from(fileList).filter(f => isTableFile(f.name));

  if (!files.length) {
    Dialog.show({
      title: 'Unsupported Files',
      message: 'No supported table files found. Please upload .vpx, .fpt, .vpt, or .zip files.',
    });
    return;
  }

  for (const file of files) {
    // Built with createElement/textContent — file names are user-controlled
    // and must never reach innerHTML.
    const li = document.createElement('li');
    li.className = 'upload-item';

    const nameEl = document.createElement('span');
    nameEl.className   = 'upload-item-name';
    nameEl.textContent = file.name;

    const sizeEl = document.createElement('span');
    sizeEl.className   = 'upload-item-size';
    sizeEl.textContent = formatBytes(file.size);

    const statusEl = document.createElement('span');
    statusEl.className   = 'upload-item-status pending';
    statusEl.textContent = 'Saving…';

    li.append(nameEl, sizeEl, statusEl);
    queue.prepend(li);

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

  Dialog.wire();

  // ── Navigation tabs ─────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-tab[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.activateSection(btn.dataset.section));
  });

  // ── Type filter buttons ─────────────────────────────────────────────────────
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
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
  document.getElementById('btnBack')?.addEventListener('click', async () => {
    const ok = await Dialog.show({
      title: 'Exit Game?',
      message: 'Stop the current game and return to the library?',
      confirmText: 'Exit',
      cancelText: 'Keep Playing',
    });
    if (ok) GameController.stop();
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

  // The whole drop zone advertises "click to browse" and is keyboard
  // focusable — wire it up (ignoring clicks that came from the inner button,
  // which already opens the picker).
  uploadZone?.addEventListener('click', e => {
    if (e.target.closest('#uploadPickBtn')) return;
    fileInput?.click();
  });
  uploadZone?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput?.click();
    }
  });

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
  document.getElementById('csmBackdrop')?.addEventListener('click', () => UI.closeComingSoon());
  document.getElementById('csmCloseBtn')?.addEventListener('click', () => UI.closeComingSoon());
  document.getElementById('csmUploadBtn')?.addEventListener('click', () => {
    UI.closeComingSoon();
    UI.activateSection('upload');
  });
  // closeComingSoon() is a no-op (returns false) when the modal is closed, so
  // Escape pressed elsewhere — e.g. exiting fullscreen mid-game — no longer
  // unlocks body scroll behind the launcher overlay.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') UI.closeComingSoon();
  });

  // ── Repository browser ──────────────────────────────────────────────────────

  UI.renderRepoPresets(RepositoryBrowser.PRESETS);

  const repoSearchInput = document.getElementById('repoSearchInput');
  let repoSearchTimer;
  let repoSearchAbort = null;

  function showRepoPresets() {
    document.getElementById('repoPresetsLabel')?.classList.remove('hidden');
    document.getElementById('repoPresets')?.classList.remove('hidden');
    document.getElementById('repoBackBtn')?.classList.add('hidden');
    document.getElementById('repoGrid').replaceChildren();
    document.getElementById('repoStats').textContent = '';
    state.repoDocs = [];
  }

  function hideRepoPresets() {
    document.getElementById('repoPresetsLabel')?.classList.add('hidden');
    document.getElementById('repoPresets')?.classList.add('hidden');
  }

  // Run an abortable Archive.org search and render the results.
  // A newer search cancels any in-flight one so stale responses can never
  // overwrite fresher results.
  async function runRepoSearch(query) {
    repoSearchAbort?.abort();
    repoSearchAbort = new AbortController();
    const signal = repoSearchAbort.signal;

    hideRepoPresets();
    const grid = document.getElementById('repoGrid');
    if (grid) UI.gridMessage(grid, 'SEARCHING…', '--cyan');
    document.getElementById('repoStats').textContent = '';

    try {
      const docs = await RepositoryBrowser.search(query, signal);
      if (signal.aborted) return;
      UI.renderRepoResults(docs);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (grid) UI.gridMessage(grid, `ERROR: ${err.message}`, '--red');
      // Recovery path: bring the presets back so the tab isn't a dead end.
      document.getElementById('repoPresetsLabel')?.classList.remove('hidden');
      document.getElementById('repoPresets')?.classList.remove('hidden');
    }
  }

  // Preset button clicks
  document.getElementById('repoPresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    const { id, type } = btn.dataset;
    const label = btn.querySelector('.preset-label')?.textContent ?? id;

    if (type === 'item') {
      hideRepoPresets();
      state.repoDocs = [];
      UI.loadRepoFiles(id, label);
    } else {
      runRepoSearch(id);
    }
  });

  // Search bar (debounced, abortable)
  repoSearchInput?.addEventListener('input', e => {
    clearTimeout(repoSearchTimer);
    const q = e.target.value.trim();
    if (!q) {
      repoSearchAbort?.abort();
      showRepoPresets();
      return;
    }
    repoSearchTimer = setTimeout(() => runRepoSearch(q + ' AND (pinball OR arcade)'), 500);
  });

  // Back button — visible on a file listing; return to the search results
  // that led there, or to the presets if there were none.
  document.getElementById('repoBackBtn')?.addEventListener('click', () => {
    if (state.repoDocs.length) {
      UI.renderRepoResults(state.repoDocs);
    } else {
      showRepoPresets();
      repoSearchInput.value = '';
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
    if (grid)  UI.gridMessage(grid, 'REGISTRY ERROR — RELOAD TO RETRY', '--red');
    if (stats) stats.textContent = 'Could not load the game registry';
  }

  try {
    state.userTables = await TableDB.getTables();
    UI.renderUserLibrary(state.userTables);
  } catch (e) {
    console.warn('[TiLT] Could not load user tables from IndexedDB:', e);
  }
});
