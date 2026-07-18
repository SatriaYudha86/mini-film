const $ = (sel) => document.querySelector(sel);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

let allMovies = [];
let setupMode = false;

// ---------- Bootstrap ----------
async function boot() {
  const status = await api('/api/status');
  if (status.authenticated) {
    showApp();
  } else {
    showAuth(!status.configured);
  }
}

// ---------- Auth ----------
function showAuth(isSetup) {
  setupMode = isSetup;
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#auth-subtitle').textContent = isSetup
    ? 'Buat password untuk mengamankan servermu.'
    : 'Masukkan password untuk masuk.';
  $('#auth-submit').textContent = isSetup ? 'Buat & Masuk' : 'Masuk';
  $('#auth-password2').classList.toggle('hidden', !isSetup);
  $('#auth-error').classList.add('hidden');
  $('#auth-password').focus();
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#auth-password').value;
  const err = $('#auth-error');
  err.classList.add('hidden');
  try {
    if (setupMode) {
      if (pw !== $('#auth-password2').value) throw new Error('Password tidak sama');
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ password: pw }) });
    } else {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
    }
    $('#auth-password').value = '';
    $('#auth-password2').value = '';
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// ---------- App ----------
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  navTo('home');
  loadMovies();
}

function navTo(view) {
  $('#view-home').classList.toggle('hidden', view !== 'home');
  $('#view-settings').classList.toggle('hidden', view !== 'settings');
  document.querySelectorAll('.nav-btn[data-nav]').forEach((b) =>
    b.classList.toggle('active', b.dataset.nav === view));
  if (view === 'settings') loadLibraries();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); navTo(nav.dataset.nav); }
});

// ---------- Movies ----------
function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}j ${m}m` : `${m}m`;
}
function fmtSize(bytes) {
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

let activeLib = null; // filter folder aktif

async function loadMovies() {
  const grid = $('#grid');
  showSkeletons(grid, 12);
  try {
    const { movies } = await api('/api/movies');
    allMovies = movies;
    renderStats(movies);
    renderFilters(movies);
    applyView();
  } catch (e) {
    $('#hero').classList.add('hidden');
    grid.innerHTML = `<p class="error">Gagal memuat: ${e.message}</p>`;
  }
}

function showSkeletons(grid, n) {
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div');
    s.className = 'movie skeleton';
    s.innerHTML = '<div class="poster-wrap sk"></div><div class="meta"><div class="sk-line"></div><div class="sk-line short"></div></div>';
    grid.appendChild(s);
  }
}

// Gabungan filter folder + pencarian
function applyView() {
  const q = $('#search').value.toLowerCase().trim();
  let list = allMovies;
  if (activeLib) list = list.filter((m) => m.library === activeLib);
  if (q) list = list.filter((m) => m.title.toLowerCase().includes(q));
  renderMovies(list);
}

function renderStats(movies) {
  const hero = $('#hero');
  if (!movies.length) { hero.classList.add('hidden'); return; }
  hero.classList.remove('hidden');
  const totalSize = movies.reduce((a, m) => a + m.size, 0);
  const totalDur = movies.reduce((a, m) => a + (m.duration || 0), 0);
  const libs = new Set(movies.map((m) => m.library));
  const hours = Math.round(totalDur / 3600);
  $('#hero-sub').textContent = `Selamat menonton — koleksi pribadimu siap diputar.`;
  $('#stats').innerHTML = [
    statTile('🎞️', movies.length, 'Film', 'a'),
    statTile('🗂️', libs.size, 'Folder', 'b'),
    statTile('⏱️', hours ? hours + ' jam' : '—', 'Total Durasi', 'c'),
    statTile('💾', fmtSize(totalSize), 'Ukuran', 'd'),
  ].join('');
}
function statTile(icon, value, label, variant) {
  return `<div class="stat stat-${variant}">
    <div class="stat-icon">${icon}</div>
    <div><div class="stat-value">${escapeHtml(String(value))}</div>
    <div class="stat-label">${escapeHtml(label)}</div></div>
  </div>`;
}

function renderFilters(movies) {
  const bar = $('#filters');
  const libs = [...new Set(movies.map((m) => m.library))];
  if (libs.length <= 1) { bar.innerHTML = ''; return; }
  const chip = (lib, label) =>
    `<button class="fchip ${activeLib === lib ? 'active' : ''}" data-lib="${lib === null ? '' : escapeHtml(lib)}">${escapeHtml(label)}</button>`;
  bar.innerHTML = chip(null, 'Semua') + libs.map((l) => chip(l, l)).join('');
  bar.querySelectorAll('.fchip').forEach((b) => {
    b.addEventListener('click', () => {
      activeLib = b.dataset.lib || null;
      bar.querySelectorAll('.fchip').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      applyView();
    });
  });
}

function renderMovies(movies) {
  const grid = $('#grid');
  const empty = $('#empty-state');
  grid.innerHTML = '';
  empty.classList.toggle('hidden', movies.length > 0);
  for (const m of movies) {
    const el = document.createElement('div');
    el.className = 'movie';
    const dur = fmtDuration(m.duration);
    const subParts = [m.year ? `<span class="chip">${escapeHtml(m.year)}</span>` : '', escapeHtml(fmtSize(m.size))].filter(Boolean).join(' ');
    const [h1, h2] = hueFor(m.title);
    el.innerHTML = `
      <div class="poster-wrap" style="--h1:${h1};--h2:${h2}">
        <div class="poster-fallback"><span>${escapeHtml(m.title.slice(0, 1).toUpperCase())}</span></div>
        <img class="poster" loading="lazy" src="/api/thumbnail/${m.id}" alt=""
             onload="this.classList.add('loaded')" />
        <div class="poster-overlay">
          <div class="play-badge"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
        </div>
        ${dur ? `<span class="badge-dur">${escapeHtml(dur)}</span>` : ''}
        <button class="kebab" title="Opsi thumbnail" aria-label="Opsi">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
        <div class="card-menu">
          <button data-act="upload">🖼️ Ubah thumbnail…</button>
          <button data-act="reset">↩️ Poster otomatis</button>
        </div>
      </div>
      <div class="meta">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="sub">${subParts}</div>
      </div>`;

    const kebab = el.querySelector('.kebab');
    const menu = el.querySelector('.card-menu');
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      closeAllMenus();
      menu.classList.toggle('open', !isOpen);
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    menu.querySelector('[data-act="upload"]').addEventListener('click', () => {
      closeAllMenus();
      pickPosterFor(m, el);
    });
    menu.querySelector('[data-act="reset"]').addEventListener('click', async () => {
      closeAllMenus();
      await resetPosterFor(m, el);
    });

    el.addEventListener('click', () => play(m));
    grid.appendChild(el);
  }
}

$('#search').addEventListener('input', applyView);

// Warna gradient deterministik dari judul (untuk poster fallback)
function hueFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return [h, (h + 40) % 360];
}

// ---------- Thumbnail kustom ----------
function closeAllMenus() {
  document.querySelectorAll('.card-menu.open').forEach((m) => m.classList.remove('open'));
}
document.addEventListener('click', closeAllMenus);

// Satu file input dipakai bersama
const posterInput = document.createElement('input');
posterInput.type = 'file';
posterInput.accept = 'image/*';
posterInput.style.display = 'none';
document.body.appendChild(posterInput);
let pendingUpload = null; // { movie, el }

function pickPosterFor(movie, el) {
  pendingUpload = { movie, el };
  posterInput.value = '';
  posterInput.click();
}

posterInput.addEventListener('change', async () => {
  const file = posterInput.files[0];
  if (!file || !pendingUpload) return;
  const { movie, el } = pendingUpload;
  pendingUpload = null;
  if (!file.type.startsWith('image/')) { toast('⚠️ File harus berupa gambar', 'error'); return; }
  try {
    const res = await fetch(`/api/thumbnail/${movie.id}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'gagal upload');
    refreshPoster(el);
    toast('🖼️ Thumbnail diperbarui', 'success');
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
});

async function resetPosterFor(movie, el) {
  try {
    await api(`/api/thumbnail/${movie.id}/custom`, { method: 'DELETE' });
    refreshPoster(el);
    toast('↩️ Kembali ke poster otomatis', 'info');
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
  }
}

// Muat ulang gambar poster pada satu kartu (bust cache).
function refreshPoster(el) {
  const img = el.querySelector('.poster');
  const base = img.getAttribute('src').split('?')[0];
  img.classList.remove('loaded');
  img.src = base + '?v=' + Date.now();
}

// ---------- Player ----------
function play(m) {
  const modal = $('#player-modal');
  const video = $('#player');
  video.src = `/api/stream/${m.id}`;
  $('#player-title').textContent = m.title + (m.year ? ` (${m.year})` : '');
  modal.classList.remove('hidden');
  video.play().catch(() => {});
}
function closePlayer() {
  const video = $('#player');
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#player-modal').classList.add('hidden');
}
$('#player-close').addEventListener('click', closePlayer);
$('#player-modal').addEventListener('click', (e) => {
  if (e.target.id === 'player-modal') closePlayer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#player-modal').classList.contains('hidden')) closePlayer();
});

// ---------- Libraries / Settings ----------
async function loadLibraries() {
  const list = $('#lib-list');
  list.innerHTML = '';
  const { libraries } = await api('/api/libraries');
  if (!libraries.length) {
    list.innerHTML = '<li class="muted">Belum ada folder.</li>';
  }
  for (const lib of libraries) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="path">${escapeHtml(lib)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'ghost small';
    btn.textContent = 'Hapus';
    btn.addEventListener('click', async () => {
      await api('/api/libraries', { method: 'DELETE', body: JSON.stringify({ dir: lib }) });
      loadLibraries();
      allMovies = []; activeLib = null;
      toast('🗑️ Folder dihapus', 'info');
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function addLibrary(dir) {
  const msg = $('#lib-msg');
  msg.textContent = '';
  try {
    await api('/api/libraries', { method: 'POST', body: JSON.stringify({ dir }) });
    $('#lib-input').value = '';
    $('#fs-browser').classList.add('hidden');
    loadLibraries();
    toast('✅ Folder ditambahkan — buka tab Film', 'success');
    msg.textContent = '';
  } catch (e) {
    toast('⚠️ ' + e.message, 'error');
    msg.innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`;
  }
}

$('#add-lib-btn').addEventListener('click', () => {
  const dir = $('#lib-input').value.trim();
  if (dir) addLibrary(dir);
});
$('#lib-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#add-lib-btn').click();
});

// ---------- Folder browser ----------
$('#browse-btn').addEventListener('click', () => {
  $('#fs-browser').classList.toggle('hidden');
  if (!$('#fs-browser').classList.contains('hidden')) browseFs('');
});
$('#fs-close').addEventListener('click', () => $('#fs-browser').classList.add('hidden'));

let fsCurrent = '';
async function browseFs(pathArg) {
  const data = await api('/api/fs?path=' + encodeURIComponent(pathArg));
  fsCurrent = data.current;
  $('#fs-current').textContent = data.current;
  const list = $('#fs-list');
  list.innerHTML = '';
  if (data.parent && data.parent !== data.current) {
    const up = document.createElement('li');
    up.className = 'up';
    up.textContent = '⬆ ..';
    up.addEventListener('click', () => browseFs(data.parent));
    list.appendChild(up);
  }
  for (const d of data.dirs) {
    const li = document.createElement('li');
    li.textContent = '📁 ' + d.name;
    li.addEventListener('click', () => browseFs(d.path));
    list.appendChild(li);
  }
}
$('#fs-pick').addEventListener('click', () => { if (fsCurrent) addLibrary(fsCurrent); });

// ---------- Toast ----------
function toast(msg, type = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot().catch((e) => {
  document.body.innerHTML = `<div class="screen center"><p class="error">Error: ${e.message}</p></div>`;
});
