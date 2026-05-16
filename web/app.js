'use strict';

// ============================================================================
// Module: TableDB  —  IndexedDB wrapper for persisting user-uploaded tables
// ============================================================================

const TableDB = (() => {
  const DB_NAME    = 'tilt-tables';
  const DB_VERSION = 1;
  const STORE      = 'tables';

  /** @returns {Promise<IDBDatabase>} */
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // Key is the file name; value is the raw File (or Blob with metadata).
          db.createObjectStore(STORE, { keyPath: 'name' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  /**
   * Save a File into IndexedDB under its name.
   * @param {File} file
   * @returns {Promise<void>}
   */
  async function saveTable(file) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      // Store the File along with lightweight metadata so getTables() is fast.
      const record = {
        name:         file.name,
        size:         file.size,
        lastModified: file.lastModified,
        file,         // The raw File object (survives page reloads in IDB)
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
      tx.oncomplete = () => db.close();
    });
  }

  /**
   * @returns {Promise<Array<{name: string, size: number, lastModified: number}>>}
   */
  async function getTables() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE, 'readonly');
      const store   = tx.objectStore(STORE);
      const req     = store.getAll();
      req.onsuccess = (e) => {
        db.close();
        resolve(e.target.result.map(r => ({
          name:         r.name,
          size:         r.size,
          lastModified: r.lastModified,
        })));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * @param {string} name  Filename (the IDB key)
   * @returns {Promise<File>}
   */
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

  /**
   * @param {string} name  Filename (the IDB key)
   * @returns {Promise<void>}
   */
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
// Module: WasmLoader  —  dynamically inserts tilt.js exactly once
// ============================================================================

const WasmLoader = (() => {
  let loadPromise = null;

  // Progress callbacks registered by the launcher UI.
  const progressListeners = [];

  function onProgress(cb) {
    progressListeners.push(cb);
  }

  function _emitProgress(pct, text) {
    progressListeners.forEach(cb => { try { cb(pct, text); } catch (_) {} });
  }

  /**
   * Insert <script src="tilt.js"> once and return a Promise that resolves
   * when the WASM runtime calls Module.onRuntimeInitialized.
   *
   * @returns {Promise<void>}
   */
  function loadEngine() {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      _emitProgress(5, 'Downloading engine…');

      // Expose the Module object that Emscripten reads on startup.
      // We set it on window so the injected <script> sees it.
      window.Module = {
        canvas: document.getElementById('canvas'),

        setStatus(text) {
          if (!text) return;
          // Parse "Downloading data... (x/y)" for fine progress.
          const m = text.match(/\((\d+)\/(\d+)\)/);
          if (m) {
            const frac = parseInt(m[1], 10) / parseInt(m[2], 10);
            _emitProgress(10 + frac * 50, `Downloading engine… ${Math.round(frac * 100)}%`);
          } else if (text.toLowerCase().includes('compiling')) {
            _emitProgress(75, 'Compiling WebAssembly…');
          } else if (text.toLowerCase().includes('running') ||
                     text.toLowerCase().includes('preparing')) {
            _emitProgress(88, 'Initialising engine…');
          } else {
            _emitProgress(80, text);
          }
        },

        onRuntimeInitialized() {
          console.log('[TiLT] WASM runtime ready');
          _emitProgress(100, 'Ready');
          resolve();
        },

        print(text) {
          console.log('[TiLT]', text);
        },

        printErr(text) {
          console.warn('[TiLT ERR]', text);
        },

        onAbort(what) {
          console.error('[TiLT] Abort:', what);
          reject(new Error('WASM abort: ' + what));
        },

        INITIAL_MEMORY: 134217728,
      };

      const script  = document.createElement('script');
      script.src    = 'tilt.js';
      script.async  = true;
      script.onerror = () => reject(new Error('Failed to load tilt.js'));
      document.body.appendChild(script);
    });

    return loadPromise;
  }

  /** True once loadEngine() has resolved. */
  function isLoaded() {
    // If the promise has settled with a value it means resolved (no rejection).
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
  let _currentTable = null;   // { name: string } | null

  /**
   * Write a File's bytes into the Emscripten virtual filesystem.
   * @param {File} file
   * @returns {string}  The WASM FS path (e.g. "/tables/foo.vpx")
   */
  function _writeFileToWasmFS(file) {
    const dir  = '/tables';
    const path = `${dir}/${file.name}`;
    try {
      // FS is a global created by Emscripten.
      if (typeof FS === 'undefined') throw new Error('FS not available');
      // Create directory if it doesn't exist.
      try { FS.mkdir(dir); } catch (_) { /* already exists */ }
      const reader = new FileReaderSync();  // Only available in Workers — fall back below.
      const buf    = reader.readAsArrayBuffer(file);
      FS.writeFile(path, new Uint8Array(buf));
    } catch (syncErr) {
      // FileReaderSync is only in Workers.  On main thread use FS.writeFile
      // after reading via FileReader (synchronously via ArrayBuffer already).
      // We rely on the caller to have pre-read the file — see launch().
      void syncErr;
    }
    return path;
  }

  /**
   * Read a File as an ArrayBuffer (returns a Promise).
   * @param {File} file
   * @returns {Promise<ArrayBuffer>}
   */
  function _readFileBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr     = new FileReader();
      fr.onload    = () => resolve(fr.result);
      fr.onerror   = () => reject(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  /**
   * Write ArrayBuffer into Emscripten FS and return the path.
   * @param {string}      name  Filename (no directory)
   * @param {ArrayBuffer} buf
   * @returns {string}  WASM FS path
   */
  function _bufferToWasmFS(name, buf) {
    const dir  = '/tables';
    const path = `${dir}/${name}`;
    try { FS.mkdir(dir); } catch (_) {}
    FS.writeFile(path, new Uint8Array(buf));
    return path;
  }

  /**
   * Launch a table.
   * @param {File}   file        The table File object
   * @param {string} displayName Human-readable name for the UI
   */
  async function launch(file, displayName) {
    _currentTable = { name: displayName || file.name };

    // 1. Show launcher UI (canvas + controls).
    UI.showLauncher(_currentTable.name);

    try {
      // 2. Load the WASM engine if not already loaded.
      await WasmLoader.loadEngine();

      // 3. Read file bytes on the main thread.
      UI.setEngineStatus('Writing table to virtual FS…', 90);
      const buf  = await _readFileBuffer(file);
      const path = _bufferToWasmFS(file.name, buf);

      // 4. Call the exported C function.
      UI.setEngineStatus('Loading table…', 95);
      Module.ccall('tilt_load_table_js', null, ['string'], [path]);

      UI.hideEngineLoading();
    } catch (err) {
      console.error('[TiLT] launch() failed:', err);
      UI.setEngineStatus('Error: ' + err.message, 0);
    }
  }

  /** Stop the running table and return to the library. */
  function stop() {
    _currentTable = null;
    try {
      if (WasmLoader.isLoaded()) {
        Module.ccall('tilt_unload_table', null, [], []);
      }
    } catch (e) {
      console.warn('[TiLT] tilt_unload_table error:', e);
    }
    UI.hideLauncher();
  }

  /** Toggle browser fullscreen on the canvas container. */
  function toggleFullscreen() {
    const el = document.getElementById('canvasContainer');
    if (!document.fullscreenElement) {
      el.requestFullscreen && el.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  }

  /** Toggle audio (mute/unmute via the WebAudio gain exposed by Emscripten). */
  function toggleAudio() {
    _audioEnabled = !_audioEnabled;
    // Emscripten's OpenAL backend uses AL.gainNode when USE_OPENAL=1.
    try {
      if (typeof AL !== 'undefined' && AL.currentCtx) {
        AL.currentCtx.gain.gain.value = _audioEnabled ? 1 : 0;
      }
    } catch (e) {
      console.warn('[TiLT] toggleAudio:', e);
    }
    return _audioEnabled;
  }

  function isAudioEnabled() { return _audioEnabled; }

  return { launch, stop, toggleFullscreen, toggleAudio, isAudioEnabled };
})();

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

    // Show engine-loading overlay (it auto-hides via hideEngineLoading).
    const overlay = document.getElementById('engineLoading');
    overlay.classList.remove('hidden');
    setEngineStatus('Downloading engine…', 5);

    // Wire progress listener.
    WasmLoader.onProgress((pct, text) => setEngineStatus(text, pct));
  }

  function hideLauncher() {
    const launcher = document.getElementById('launcher');
    launcher.classList.add('hidden');
    document.body.style.overflow = '';
    // Reset engine overlay for next launch.
    document.getElementById('engineLoading').classList.remove('hidden');
  }

  function setEngineStatus(text, pct) {
    const el   = document.getElementById('engineStatus');
    const fill = document.getElementById('engineProgressFill');
    if (el)   el.textContent      = text || '';
    if (fill) fill.style.width    = Math.min(100, pct || 0) + '%';
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
   * Render the demo-table grid.
   * @param {Array} tables
   * @param {string} query
   * @param {string} manufacturer
   */
  function renderLibrary(tables, query, manufacturer) {
    const grid  = document.getElementById('tableGrid');
    const stats = document.getElementById('tableStats');
    if (!grid) return;

    const q = (query || '').toLowerCase();
    const m = manufacturer || '';

    const filtered = tables.filter(t => {
      const matchQ = !q || t.name.toLowerCase().includes(q) || t.manufacturer.toLowerCase().includes(q);
      const matchM = !m || t.manufacturer === m;
      return matchQ && matchM;
    });

    stats.textContent = (q || m)
      ? `${filtered.length} of ${tables.length} tables`
      : `${tables.length} classic tables — demo data`;

    grid.innerHTML = '';
    for (const t of filtered) {
      grid.appendChild(_buildDemoCard(t));
    }
  }

  function _buildDemoCard(table) {
    const card  = document.createElement('div');
    card.className   = 'table-card';
    card.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    thumb.className  = 'card-thumb';
    thumb.textContent = table.emoji;

    if (table.badge) {
      const badge = document.createElement('span');
      badge.className  = 'card-badge';
      badge.textContent = table.badge;
      thumb.appendChild(badge);
    }

    const body   = document.createElement('div');
    body.className    = 'card-body';

    const name   = document.createElement('div');
    name.className    = 'card-name';
    name.textContent  = table.name;

    const meta   = document.createElement('div');
    meta.className    = 'card-meta';
    meta.textContent  = `${table.manufacturer} · ${table.year}`;

    const rating = document.createElement('div');
    rating.className  = 'card-rating';
    rating.textContent = '★'.repeat(Math.round(table.rating)) + ` ${table.rating.toFixed(1)}`;

    body.append(name, meta, rating);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const playBtn = document.createElement('button');
    playBtn.className  = 'btn btn-primary';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _showComingSoon(table.name);
    });

    actions.appendChild(playBtn);
    card.append(thumb, body, actions);

    card.addEventListener('click', () => _showComingSoon(table.name));
    return card;
  }

  /**
   * Render the user-uploaded tables grid from IndexedDB metadata.
   * @param {Array<{name: string, size: number, lastModified: number}>} tables
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

    for (const t of tables) {
      grid.appendChild(_buildUserCard(t));
    }
  }

  function _buildUserCard(meta) {
    const ext  = (meta.name.split('.').pop() || '').toLowerCase();
    const emoji = ext === 'vpx' ? '🎯' : ext === 'fpt' ? '🎳' : '📦';

    const card   = document.createElement('div');
    card.className    = 'table-card user-card';
    card.setAttribute('role', 'listitem');

    const thumb  = document.createElement('div');
    thumb.className   = 'card-thumb';
    thumb.textContent = emoji;

    const badge  = document.createElement('span');
    badge.className   = 'card-badge card-badge-user';
    badge.textContent = ext.toUpperCase();
    thumb.appendChild(badge);

    const body   = document.createElement('div');
    body.className    = 'card-body';

    const name   = document.createElement('div');
    name.className    = 'card-name';
    name.textContent  = meta.name.replace(/\.[^.]+$/, '');

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
        GameController.launch(file, meta.name.replace(/\.[^.]+$/, ''));
      } catch (err) {
        console.error('[TiLT] Could not retrieve table from IDB:', err);
        alert('Could not load the table file. It may have been removed from local storage.');
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className  = 'btn btn-secondary';
    delBtn.title       = 'Delete from local storage';
    delBtn.setAttribute('aria-label', `Delete ${meta.name}`);
    delBtn.innerHTML   = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
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

  // ── "Coming soon" modal ────────────────────────────────────────────────────

  function _showComingSoon(tableName) {
    const modal = document.getElementById('comingSoonModal');
    document.getElementById('csmTableName').textContent = `"${tableName}"`;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('csmCloseBtn').focus();
  }

  function _hideComingSoon() {
    document.getElementById('comingSoonModal').classList.add('hidden');
    document.body.style.overflow = '';
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

  // Expose some helpers.
  return {
    showLauncher, hideLauncher,
    setEngineStatus, hideEngineLoading,
    renderLibrary, renderUserLibrary,
    activateSection,
  };
})();

// ============================================================================
// Demo table data
// ============================================================================

const DEMO_TABLES = [
  { name: 'Medieval Madness',        manufacturer: 'Williams', year: 1997, rating: 5.0, emoji: '🏰', badge: 'Classic' },
  { name: 'Attack from Mars',        manufacturer: 'Bally',    year: 1995, rating: 4.9, emoji: '🚀', badge: 'Classic' },
  { name: 'The Addams Family',       manufacturer: 'Bally',    year: 1992, rating: 4.9, emoji: '👻', badge: 'Iconic'  },
  { name: 'Theatre of Magic',        manufacturer: 'Bally',    year: 1995, rating: 4.8, emoji: '🎩', badge: null      },
  { name: 'Twilight Zone',           manufacturer: 'Williams', year: 1993, rating: 4.8, emoji: '🌀', badge: 'Iconic'  },
  { name: 'Indiana Jones',           manufacturer: 'Williams', year: 1993, rating: 4.7, emoji: '🎒', badge: null      },
  { name: 'Monster Bash',            manufacturer: 'Williams', year: 1998, rating: 4.7, emoji: '🧛', badge: null      },
  { name: 'Scared Stiff',            manufacturer: 'Bally',    year: 1996, rating: 4.6, emoji: '🕷️', badge: null    },
  { name: 'Star Trek: The Next Gen', manufacturer: 'Williams', year: 1993, rating: 4.6, emoji: '⭐', badge: null      },
  { name: 'Cirqus Voltaire',         manufacturer: 'Williams', year: 1997, rating: 4.5, emoji: '🎪', badge: null      },
  { name: 'Junk Yard',               manufacturer: 'Williams', year: 1996, rating: 4.4, emoji: '🔧', badge: null      },
  { name: 'No Good Gofers',          manufacturer: 'Williams', year: 1997, rating: 4.3, emoji: '⛳', badge: null      },
];

// ============================================================================
// State
// ============================================================================

const state = {
  search:       '',
  manufacturer: '',
  userTables:   [],
};

// ============================================================================
// Upload handling
// ============================================================================

const ALLOWED_EXT = new Set(['vpx', 'fpt', 'vpt', 'zip']);

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function isTableFile(name) {
  return ALLOWED_EXT.has(extOf(name));
}

function formatBytes(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

async function handleFiles(fileList) {
  const queue = document.getElementById('uploadQueue');
  const files = Array.from(fileList).filter(f => isTableFile(f.name));

  if (!files.length) {
    alert('No supported table files found. Please upload .vpx, .fpt, .vpt, or .zip files.');
    return;
  }

  for (const file of files) {
    // Add a queue item.
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

  // Refresh the user table grid.
  state.userTables = await TableDB.getTables();
  UI.renderUserLibrary(state.userTables);
}

// ============================================================================
// Event wiring
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {

  // ── Navigation tabs ────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-tab[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.activateSection(btn.dataset.section));
  });

  // ── Search / filter ────────────────────────────────────────────────────────
  const searchInput        = document.getElementById('searchInput');
  const filterManufacturer = document.getElementById('filterManufacturer');

  function applyFilter() {
    UI.renderLibrary(DEMO_TABLES, state.search, state.manufacturer);
  }

  searchInput?.addEventListener('input', e => {
    state.search = e.target.value;
    applyFilter();
  });

  filterManufacturer?.addEventListener('change', e => {
    state.manufacturer = e.target.value;
    applyFilter();
  });

  // ── Launcher controls ──────────────────────────────────────────────────────
  document.getElementById('btnBack')?.addEventListener('click', () => {
    if (confirm('Stop the current game and return to the library?')) {
      GameController.stop();
    }
  });

  document.getElementById('btnFullscreen')?.addEventListener('click', () => {
    GameController.toggleFullscreen();
  });

  document.getElementById('btnAudio')?.addEventListener('click', () => {
    const enabled = GameController.toggleAudio();
    const btn     = document.getElementById('btnAudio');
    const icon    = document.getElementById('audioIcon');
    btn.setAttribute('aria-pressed', String(enabled));
    // Swap icon between speaker-on and speaker-off (muted).
    if (enabled) {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>`;
    } else {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>`;
    }
  });

  // Update fullscreen icon on fullscreenchange event.
  document.addEventListener('fullscreenchange', () => {
    const isFS = !!document.fullscreenElement;
    const icon = document.getElementById('fullscreenIcon');
    if (!icon) return;
    if (isFS) {
      icon.innerHTML = `
        <polyline points="4 14 10 14 10 20"/>
        <polyline points="20 10 14 10 14 4"/>
        <line x1="10" y1="14" x2="3" y2="21"/>
        <line x1="21" y1="3" x2="14" y2="10"/>`;
    } else {
      icon.innerHTML = `
        <polyline points="15 3 21 3 21 9"/>
        <polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/>
        <line x1="3" y1="21" x2="10" y2="14"/>`;
    }
  });

  // ── Upload zone ────────────────────────────────────────────────────────────
  const uploadZone = document.getElementById('uploadZone');
  const fileInput  = document.getElementById('fileInput');
  const pickBtn    = document.getElementById('uploadPickBtn');

  pickBtn?.addEventListener('click', () => fileInput?.click());
  uploadZone?.addEventListener('click', e => {
    if (e.target === uploadZone || e.target.closest('.upload-zone-inner') === e.target.closest('#uploadZone')) {
      if (e.target !== pickBtn) fileInput?.click();
    }
  });
  uploadZone?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); }
  });

  fileInput?.addEventListener('change', e => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = ''; // reset so same file can be re-selected
  });

  // Drag-and-drop on the entire page.
  let dragDepth = 0;
  document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragDepth++;
    uploadZone?.classList.add('drag-over');
  });
  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; uploadZone?.classList.remove('drag-over'); }
  });
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    uploadZone?.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files?.length) {
      // Auto-switch to upload section so the progress is visible.
      UI.activateSection('upload');
      handleFiles(files);
    }
  });

  // ── Coming-soon modal ──────────────────────────────────────────────────────
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
      document.getElementById('launcher')?.classList.contains('hidden') || null;
      document.body.style.overflow = '';
    }
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  UI.renderLibrary(DEMO_TABLES, '', '');

  try {
    state.userTables = await TableDB.getTables();
    UI.renderUserLibrary(state.userTables);
  } catch (e) {
    console.warn('[TiLT] Could not load user tables from IndexedDB:', e);
  }
});
