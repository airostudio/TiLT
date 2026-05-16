/**
 * TiLT renderer process
 *
 * Handles the table browser UI, search, settings, and communicates
 * with the main process via window.tilt (exposed through preload.js).
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  tables: [],
  filtered: [],
  search: '',
  tablesFolder: localStorage.getItem('tablesFolder') || '',
  renderer: localStorage.getItem('renderer') || 'opengl',
  vrMode: localStorage.getItem('vrMode') === 'true',
  engineRunning: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const tableGrid       = $('tableGrid');
const tableStats      = $('tableStats');
const emptyState      = $('emptyState');
const searchInput     = $('searchInput');
const filterRenderer  = $('filterRenderer');
const engineIndicator = $('engineIndicator');
const launchOverlay   = $('launchOverlay');
const launchTitle     = $('launchTitle');
const launchLog       = $('launchLog');

// ── Routing ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`view-${view}`)?.classList.add('active');
    if (view === 'settings') populateSettings();
  });
});

// ── Engine status ─────────────────────────────────────────────────────────────
async function checkEngineStatus() {
  const { available, path: binaryPath } = await window.tilt.engineStatus();
  const detail = $('engineStatusDetail');
  if (available) {
    detail.innerHTML = `<strong style="color:var(--success)">Binary found</strong><br>${binaryPath}`;
  } else {
    detail.innerHTML = `<strong style="color:var(--danger)">Binary not found</strong><br>
      Build the project first: <code>cmake -B build && cmake --build build</code>`;
  }
}

function setEngineRunning(running) {
  state.engineRunning = running;
  engineIndicator.className = 'engine-indicator' + (running ? ' running' : '');
  engineIndicator.querySelector('.indicator-label').textContent =
    running ? 'Engine running' : 'Engine offline';
}

window.tilt.onEngineStopped(() => {
  setEngineRunning(false);
  launchOverlay.classList.add('hidden');
});

window.tilt.onEngineLog((line) => {
  launchLog.textContent += line + '\n';
  launchLog.scrollTop = launchLog.scrollHeight;
});

// ── Table loading ─────────────────────────────────────────────────────────────
async function loadTablesFromFolder(folder) {
  if (!folder) return;
  const tables = await window.tilt.scanFolder(folder);
  state.tables = tables;
  state.tablesFolder = folder;
  localStorage.setItem('tablesFolder', folder);
  applyFilter();
}

window.tilt.onFolderSelected((folder) => loadTablesFromFolder(folder));

// ── Filtering ─────────────────────────────────────────────────────────────────
function applyFilter() {
  const q = state.search.toLowerCase();
  state.filtered = q
    ? state.tables.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.manufacturer || '').toLowerCase().includes(q)
      )
    : [...state.tables];
  renderGrid();
}

searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  applyFilter();
});

// ── Grid rendering ────────────────────────────────────────────────────────────
function renderGrid() {
  const total = state.tables.length;
  const shown = state.filtered.length;

  tableStats.textContent = total === 0
    ? 'No tables — add a folder to get started.'
    : shown === total
      ? `${total} table${total !== 1 ? 's' : ''}`
      : `${shown} of ${total} tables`;

  if (total === 0) {
    emptyState.classList.remove('hidden');
    tableGrid.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  tableGrid.innerHTML = '';

  for (const table of state.filtered) {
    tableGrid.appendChild(buildCard(table));
  }
}

function buildCard(table) {
  const card = document.createElement('div');
  card.className = 'table-card';

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';

  if (table.thumbnailPath || table.wheelImagePath) {
    const img = document.createElement('img');
    img.src = table.thumbnailPath || table.wheelImagePath;
    img.alt = table.name;
    thumb.appendChild(img);
  } else {
    thumb.textContent = pinballEmoji(table.name);
  }

  const extBadge = document.createElement('span');
  extBadge.className = 'card-ext';
  extBadge.textContent = table.ext || 'vpx';
  thumb.appendChild(extBadge);

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = table.name;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const parts = [];
  if (table.manufacturer) parts.push(table.manufacturer);
  if (table.year) parts.push(table.year);
  meta.textContent = parts.join(' · ') || 'Unknown';

  body.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const launchBtn = document.createElement('button');
  launchBtn.className = 'btn btn-primary';
  launchBtn.textContent = 'Launch';
  launchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    launchTable(table);
  });

  actions.appendChild(launchBtn);
  card.append(thumb, body, actions);
  return card;
}

const EMOJI_MAP = [
  [/mediev|knight|castle/i, '🏰'],
  [/mars|space|alien|galaxy/i, '🚀'],
  [/star|trek|wars/i, '⭐'],
  [/circu|clown|fun/i, '🎪'],
  [/monster|dracula|undead/i, '🧛'],
  [/fish|aqua|shark/i, '🦈'],
  [/thunder|lightning|storm/i, '⚡'],
  [/fire|flame|inferno/i, '🔥'],
  [/jungle|safari|lion/i, '🦁'],
  [/indi|jones|adventure/i, '🎩'],
];

function pinballEmoji(name) {
  for (const [re, emoji] of EMOJI_MAP) {
    if (re.test(name)) return emoji;
  }
  return '🎯';
}

// ── Launch ────────────────────────────────────────────────────────────────────
async function launchTable(table) {
  if (state.engineRunning) return;

  launchTitle.textContent = `Launching ${table.name}…`;
  launchLog.textContent = '';
  launchOverlay.classList.remove('hidden');
  setEngineRunning(true);

  try {
    await window.tilt.launchTable({
      tableFile: table.filename,
      romName: table.romName || null,
      renderer: filterRenderer.value || state.renderer,
      vr: state.vrMode,
    });
  } catch (err) {
    launchLog.textContent += `\nError: ${err.message}`;
    setEngineRunning(false);
    // Keep overlay open so user can read the error
  }
}

async function launchFile() {
  const filePath = await window.tilt.chooseFile();
  if (!filePath) return;
  const name = filePath.split('/').pop().replace(/\.[^.]+$/, '');
  launchTable({ name, filename: filePath, ext: filePath.split('.').pop() });
}

// ── Add folder ────────────────────────────────────────────────────────────────
$('btnAddFolder').addEventListener('click', async () => {
  const folder = await window.tilt.chooseFolder();
  if (folder) loadTablesFromFolder(folder);
});

$('btnAddFolderEmpty').addEventListener('click', async () => {
  const folder = await window.tilt.chooseFolder();
  if (folder) loadTablesFromFolder(folder);
});

$('btnOpenFile').addEventListener('click', launchFile);

$('btnStopEngine').addEventListener('click', async () => {
  await window.tilt.stopEngine();
  setEngineRunning(false);
  launchOverlay.classList.add('hidden');
});

// ── Settings ──────────────────────────────────────────────────────────────────
function populateSettings() {
  $('settingsTablesFolder').value = state.tablesFolder;
  $('settingsRenderer').value = state.renderer;
  $('settingsVR').checked = state.vrMode;
  checkEngineStatus();
}

$('btnChooseTablesFolder').addEventListener('click', async () => {
  const folder = await window.tilt.chooseFolder();
  if (folder) {
    $('settingsTablesFolder').value = folder;
  }
});

$('btnSaveSettings').addEventListener('click', () => {
  const folder = $('settingsTablesFolder').value.trim();
  const renderer = $('settingsRenderer').value;
  const vr = $('settingsVR').checked;

  state.renderer = renderer;
  state.vrMode = vr;

  localStorage.setItem('renderer', renderer);
  localStorage.setItem('vrMode', String(vr));

  if (folder && folder !== state.tablesFolder) {
    loadTablesFromFolder(folder);
  }

  $('btnSaveSettings').textContent = 'Saved!';
  setTimeout(() => { $('btnSaveSettings').textContent = 'Save'; }, 1500);
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  filterRenderer.value = state.renderer;

  if (state.tablesFolder) {
    await loadTablesFromFolder(state.tablesFolder);
  } else {
    renderGrid();
  }
})();
