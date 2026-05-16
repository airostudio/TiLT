'use strict';

// ── Demo table data ───────────────────────────────────────────────────────────
// In the desktop app this comes from scanning a local folder.
// Here we use representative demo data so the UI is fully interactive.
const DEMO_TABLES = [
  { name: 'Medieval Madness',        manufacturer: 'Williams',  year: 1997, rating: 5.0, emoji: '🏰', badge: 'Classic' },
  { name: 'Attack from Mars',        manufacturer: 'Bally',     year: 1995, rating: 4.9, emoji: '🚀', badge: 'Classic' },
  { name: 'The Addams Family',       manufacturer: 'Bally',     year: 1992, rating: 4.9, emoji: '👻', badge: 'Iconic'  },
  { name: 'Theatre of Magic',        manufacturer: 'Bally',     year: 1995, rating: 4.8, emoji: '🎩', badge: null      },
  { name: 'Twilight Zone',           manufacturer: 'Williams',  year: 1993, rating: 4.8, emoji: '🌀', badge: 'Iconic'  },
  { name: 'Indiana Jones',           manufacturer: 'Williams',  year: 1993, rating: 4.7, emoji: '🎒', badge: null      },
  { name: 'Monster Bash',            manufacturer: 'Williams',  year: 1998, rating: 4.7, emoji: '🧛', badge: null      },
  { name: 'Scared Stiff',            manufacturer: 'Bally',     year: 1996, rating: 4.6, emoji: '🕷️', badge: null     },
  { name: 'Star Trek: The Next Gen', manufacturer: 'Williams',  year: 1993, rating: 4.6, emoji: '⭐', badge: null      },
  { name: 'Cirqus Voltaire',         manufacturer: 'Williams',  year: 1997, rating: 4.5, emoji: '🎪', badge: null      },
  { name: 'Junk Yard',               manufacturer: 'Williams',  year: 1996, rating: 4.4, emoji: '🔧', badge: null      },
  { name: 'No Good Gofers',          manufacturer: 'Williams',  year: 1997, rating: 4.3, emoji: '⛳', badge: null      },
];

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  tables: DEMO_TABLES,
  filtered: [...DEMO_TABLES],
  search: '',
  manufacturer: '',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tableGrid          = document.getElementById('tableGrid');
const tableStats         = document.getElementById('tableStats');
const searchInput        = document.getElementById('searchInput');
const filterManufacturer = document.getElementById('filterManufacturer');
const downloadModal      = document.getElementById('downloadModal');
const modalTableName     = document.getElementById('modalTableName');
const modalBackdrop      = document.getElementById('modalBackdrop');
const modalCloseBtn      = document.getElementById('modalCloseBtn');
const modalDownloadBtn   = document.getElementById('modalDownloadBtn');

// ── View routing ──────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${view}`)?.classList.add('active');
  });
});

// ── Filtering ─────────────────────────────────────────────────────────────────
function applyFilter() {
  const q = state.search.toLowerCase();
  const m = state.manufacturer;

  state.filtered = state.tables.filter((t) => {
    const matchQ = !q || t.name.toLowerCase().includes(q) || t.manufacturer.toLowerCase().includes(q);
    const matchM = !m || t.manufacturer === m;
    return matchQ && matchM;
  });

  renderGrid();
}

searchInput.addEventListener('input', (e) => {
  state.search = e.target.value;
  applyFilter();
});

filterManufacturer.addEventListener('change', (e) => {
  state.manufacturer = e.target.value;
  applyFilter();
});

// ── Grid rendering ────────────────────────────────────────────────────────────
function renderGrid() {
  const total = state.tables.length;
  const shown = state.filtered.length;

  tableStats.textContent = state.search || state.manufacturer
    ? `${shown} of ${total} tables`
    : `${total} classic tables — demo data`;

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
  thumb.textContent = table.emoji;

  if (table.badge) {
    const badge = document.createElement('span');
    badge.className = 'card-badge';
    badge.textContent = table.badge;
    thumb.appendChild(badge);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = table.name;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = `${table.manufacturer} · ${table.year}`;

  const rating = document.createElement('div');
  rating.className = 'card-rating';
  rating.textContent = '★'.repeat(Math.round(table.rating)) + ` ${table.rating.toFixed(1)}`;

  body.append(name, meta, rating);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn-primary';
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => showDownloadPrompt(table));

  actions.appendChild(playBtn);
  card.append(thumb, body, actions);

  card.addEventListener('click', (e) => {
    if (e.target === playBtn) return;
    showDownloadPrompt(table);
  });

  return card;
}

// ── Download prompt ───────────────────────────────────────────────────────────
function showDownloadPrompt(table) {
  modalTableName.textContent = `"${table.name}"`;
  downloadModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modalDownloadBtn.focus();
}

function hideModal() {
  downloadModal.classList.add('hidden');
  document.body.style.overflow = '';
}

modalCloseBtn.addEventListener('click', hideModal);
modalBackdrop.addEventListener('click', hideModal);
modalDownloadBtn.addEventListener('click', () => {
  hideModal();
  document.querySelector('[data-view="about"]').click();
  setTimeout(() => {
    document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
});

// ── Init ──────────────────────────────────────────────────────────────────────
renderGrid();
