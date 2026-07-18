const $ = (sel) => document.querySelector(sel);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
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
  const status = await api("/api/status");
  if (status.authenticated) {
    showApp();
  } else {
    showAuth(!status.configured);
  }
}

// ---------- Auth ----------
function showAuth(isSetup) {
  setupMode = isSetup;
  $("#app").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
  $("#auth-subtitle").textContent = isSetup
    ? "Create a password to secure your server."
    : "Enter your password to sign in.";
  $("#auth-submit").textContent = isSetup ? "Create & sign in" : "Sign in";
  $("#auth-password2").classList.toggle("hidden", !isSetup);
  $("#auth-error").classList.add("hidden");
  $("#auth-password").focus();
}

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#auth-password").value;
  const err = $("#auth-error");
  err.classList.add("hidden");
  try {
    if (setupMode) {
      if (pw !== $("#auth-password2").value)
        throw new Error("Passwords do not match");
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
    } else {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
    }
    $("#auth-password").value = "";
    $("#auth-password2").value = "";
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

// ---------- App ----------
function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  navTo("home");
  loadMovies();
}

function navTo(view) {
  $("#view-home").classList.toggle("hidden", view !== "home");
  $("#view-settings").classList.toggle("hidden", view !== "settings");
  document
    .querySelectorAll(".nav-btn[data-nav]")
    .forEach((b) => b.classList.toggle("active", b.dataset.nav === view));
  if (view === "settings") loadLibraries();
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    e.preventDefault();
    navTo(nav.dataset.nav);
  }
});

// ---------- Movies ----------
function fmtDuration(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtSize(bytes) {
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

let activeLib = null; // active folder filter

async function loadMovies() {
  const grid = $("#grid");
  showSkeletons(grid, 12);
  try {
    const { movies } = await api("/api/movies");
    allMovies = movies;
    renderStats(movies);
    renderFilters(movies);
    applyView();
  } catch (e) {
    $("#hero").classList.add("hidden");
    grid.innerHTML = `<p class="error">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

function showSkeletons(grid, n) {
  grid.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "movie skeleton";
    s.innerHTML =
      '<div class="poster-wrap sk"></div><div class="meta"><div class="sk-line"></div><div class="sk-line short"></div></div>';
    grid.appendChild(s);
  }
}

// Combined folder filter + search
function applyView() {
  const q = $("#search").value.toLowerCase().trim();
  let list = allMovies;
  if (activeLib) list = list.filter((m) => m.library === activeLib);
  if (q) list = list.filter((m) => m.title.toLowerCase().includes(q));
  renderMovies(list);
}

function renderStats(items) {
  const hero = $("#hero");
  if (!items.length) {
    hero.classList.add("hidden");
    return;
  }
  hero.classList.remove("hidden");
  const filmCount = items.filter((m) => m.type !== "series").length;
  const seriesCount = items.filter((m) => m.type === "series").length;
  const totalSize = items.reduce((a, m) => a + m.size, 0);
  const libs = new Set(items.map((m) => m.library));
  $("#hero-sub").textContent =
    `Enjoy — your personal collection is ready to play.`;
  $("#stats").innerHTML = [
    statTile("🎞️", filmCount, "Movies", "a"),
    statTile("📺", seriesCount, "Series", "c"),
    statTile("🗂️", libs.size, "Folders", "b"),
    statTile("💾", fmtSize(totalSize), "Size", "d"),
  ].join("");
}
function statTile(icon, value, label, variant) {
  return `<div class="stat stat-${variant}">
    <div class="stat-icon">${icon}</div>
    <div><div class="stat-value">${escapeHtml(String(value))}</div>
    <div class="stat-label">${escapeHtml(label)}</div></div>
  </div>`;
}

function renderFilters(movies) {
  const bar = $("#filters");
  const libs = [...new Set(movies.map((m) => m.library))];
  if (libs.length <= 1) {
    bar.innerHTML = "";
    return;
  }
  const chip = (lib, label) =>
    `<button class="fchip ${activeLib === lib ? "active" : ""}" data-lib="${lib === null ? "" : escapeHtml(lib)}">${escapeHtml(label)}</button>`;
  bar.innerHTML = chip(null, "All") + libs.map((l) => chip(l, l)).join("");
  bar.querySelectorAll(".fchip").forEach((b) => {
    b.addEventListener("click", () => {
      activeLib = b.dataset.lib || null;
      bar
        .querySelectorAll(".fchip")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      applyView();
    });
  });
}

function renderMovies(items) {
  const grid = $("#grid");
  const empty = $("#empty-state");
  grid.innerHTML = "";
  empty.classList.toggle("hidden", items.length > 0);
  for (const m of items) {
    const isSeries = m.type === "series";
    const el = document.createElement("div");
    el.className = "movie";
    const badge = isSeries
      ? `<span class="badge-series">📺 ${m.episodeCount} eps</span>`
      : fmtDuration(m.duration)
        ? `<span class="badge-dur">${escapeHtml(fmtDuration(m.duration))}</span>`
        : "";
    const subParts = [
      m.year ? `<span class="chip">${escapeHtml(m.year)}</span>` : "",
      isSeries ? "Series" : escapeHtml(fmtSize(m.size)),
    ]
      .filter(Boolean)
      .join(" ");
    const [h1, h2] = hueFor(m.title);
    el.innerHTML = `
      <div class="poster-wrap" style="--h1:${h1};--h2:${h2}">
        <div class="poster-fallback"><span>${escapeHtml(m.title.slice(0, 1).toUpperCase())}</span></div>
        <img class="poster" loading="lazy" src="/api/thumbnail/${m.posterId}" alt=""
             onload="this.classList.add('loaded')" />
        <div class="poster-overlay">
          <div class="play-badge">${
            isSeries
              ? '<svg viewBox="0 0 24 24"><path d="M4 6h16v10H4zM2 18h20v2H2z"/></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
          }</div>
        </div>
        ${badge}
        <button class="kebab" title="Thumbnail options" aria-label="Options">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
        <div class="card-menu">
          <button data-act="upload">🖼️ Change thumbnail…</button>
          <button data-act="reset">↩️ Automatic poster</button>
        </div>
      </div>
      <div class="meta">
        <div class="title">${escapeHtml(m.title)}</div>
        <div class="sub">${subParts}</div>
      </div>`;

    const kebab = el.querySelector(".kebab");
    const menu = el.querySelector(".card-menu");
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains("open");
      closeAllMenus();
      menu.classList.toggle("open", !isOpen);
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    menu.querySelector('[data-act="upload"]').addEventListener("click", () => {
      closeAllMenus();
      pickPosterFor(m, el);
    });
    menu
      .querySelector('[data-act="reset"]')
      .addEventListener("click", async () => {
        closeAllMenus();
        await resetPosterFor(m, el);
      });

    el.addEventListener("click", () =>
      isSeries ? openSeries(m, el) : play(m),
    );
    grid.appendChild(el);
  }
}

// ---------- Series modal ----------
function openSeries(series, cardEl) {
  $("#series-title").textContent =
    series.title + (series.year ? ` (${series.year})` : "");
  $("#series-meta").textContent =
    `${series.episodeCount} episodes · ${fmtSize(series.size)}`;
  const poster = $("#series-poster");
  poster.src = cardEl.querySelector(".poster").src; // reuse (keeps the cache-bust query if edited)
  const list = $("#episode-list");
  list.innerHTML = "";
  series.episodes.forEach((ep, i) => {
    const li = document.createElement("li");
    const dur = fmtDuration(ep.duration);
    li.innerHTML = `
      <span class="ep-num">${i + 1}</span>
      <span class="ep-title">${escapeHtml(ep.title)}</span>
      <span class="ep-meta">${[dur, fmtSize(ep.size)].filter(Boolean).join(" · ")}</span>
      <span class="ep-play">▶</span>`;
    li.addEventListener("click", () =>
      play(
        { id: ep.id, title: `${series.title} — ${ep.title}` },
        { episodes: series.episodes, index: i, seriesTitle: series.title },
      ),
    );
    list.appendChild(li);
  });
  $("#series-modal").classList.remove("hidden");
}
function closeSeries() {
  $("#series-modal").classList.add("hidden");
}
$("#series-close").addEventListener("click", closeSeries);
$("#series-modal").addEventListener("click", (e) => {
  if (e.target.id === "series-modal") closeSeries();
});

$("#search").addEventListener("input", applyView);

// Deterministic gradient colour from the title (for the poster fallback)
function hueFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return [h, (h + 40) % 360];
}

// ---------- Custom thumbnail ----------
function closeAllMenus() {
  document
    .querySelectorAll(".card-menu.open")
    .forEach((m) => m.classList.remove("open"));
}
document.addEventListener("click", closeAllMenus);

// A single shared file input
const posterInput = document.createElement("input");
posterInput.type = "file";
posterInput.accept = "image/*";
posterInput.style.display = "none";
document.body.appendChild(posterInput);
let pendingUpload = null; // { movie, el }

function pickPosterFor(movie, el) {
  pendingUpload = { movie, el };
  posterInput.value = "";
  posterInput.click();
}

posterInput.addEventListener("change", async () => {
  const file = posterInput.files[0];
  if (!file || !pendingUpload) return;
  const { movie, el } = pendingUpload;
  pendingUpload = null;
  if (!file.type.startsWith("image/")) {
    toast("⚠️ File must be an image", "error");
    return;
  }
  try {
    const res = await fetch(`/api/thumbnail/${movie.posterId}/upload`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "upload failed");
    refreshPoster(el);
    toast("🖼️ Thumbnail updated", "success");
  } catch (e) {
    toast("⚠️ " + e.message, "error");
  }
});

async function resetPosterFor(movie, el) {
  try {
    await api(`/api/thumbnail/${movie.posterId}/custom`, { method: "DELETE" });
    refreshPoster(el);
    toast("↩️ Reverted to automatic poster", "info");
  } catch (e) {
    toast("⚠️ " + e.message, "error");
  }
}

// Reload one card's poster image (cache-busting).
function refreshPoster(el) {
  const img = el.querySelector(".poster");
  const base = img.getAttribute("src").split("?")[0];
  img.classList.remove("loaded");
  img.src = base + "?v=" + Date.now();
}

// ---------- Player ----------
// Series playback context: { episodes, index, seriesTitle }. null = standalone movie.
let playCtx = null;

function play(m, ctx = null) {
  playCtx = ctx;
  const modal = $("#player-modal");
  const video = $("#player");
  video.src = `/api/stream/${m.id}`;
  $("#player-title").textContent = m.title + (m.year ? ` (${m.year})` : "");
  updatePlayerNav();
  modal.classList.remove("hidden");
  video.play().catch(() => {});
}

// Play episode i of the series currently open.
function playEpisodeAt(i) {
  if (!playCtx) return;
  const eps = playCtx.episodes;
  if (i < 0 || i >= eps.length) return;
  playCtx.index = i;
  const ep = eps[i];
  play({ id: ep.id, title: `${playCtx.seriesTitle} — ${ep.title}` }, playCtx);
}

function updatePlayerNav() {
  const nav = $("#player-nav");
  if (!playCtx) {
    nav.classList.add("hidden");
    return;
  }
  const { episodes, index } = playCtx;
  nav.classList.remove("hidden");
  $("#prev-ep").disabled = index <= 0;
  $("#next-ep").disabled = index >= episodes.length - 1;
  $("#ep-indicator").textContent =
    `Episode ${index + 1} of ${episodes.length}`;
}

$("#prev-ep").addEventListener("click", () =>
  playEpisodeAt(playCtx ? playCtx.index - 1 : 0),
);
$("#next-ep").addEventListener("click", () =>
  playEpisodeAt(playCtx ? playCtx.index + 1 : 0),
);

function closePlayer() {
  const video = $("#player");
  video.pause();
  video.removeAttribute("src");
  video.load();
  playCtx = null;
  $("#player-nav").classList.add("hidden");
  $("#shortcut-help").classList.add("hidden");
  $("#player-modal").classList.add("hidden");
}
// Deliberately no click-outside-to-close here: a stray click while watching
// should not stop playback. Close with the X button or Esc.
$("#player-close").addEventListener("click", closePlayer);
// ---------- Keyboard shortcuts (YouTube-style) ----------
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function isPlayerOpen() {
  return !$("#player-modal").classList.contains("hidden");
}
function isSeriesOpen() {
  return !$("#series-modal").classList.contains("hidden");
}
function isTyping(el) {
  return (
    el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable)
  );
}

function seekBy(sec) {
  const v = $("#player");
  if (!Number.isFinite(v.duration)) return;
  v.currentTime = Math.min(Math.max(v.currentTime + sec, 0), v.duration);
}
function setVolume(delta) {
  const v = $("#player");
  v.volume = Math.min(Math.max(v.volume + delta, 0), 1);
  if (v.volume > 0) v.muted = false;
}
function stepFrame(dir) {
  const v = $("#player");
  v.pause();
  if (!Number.isFinite(v.duration)) return;
  v.currentTime = Math.min(Math.max(v.currentTime + dir / 30, 0), v.duration);
}
function changeRate(dir) {
  const v = $("#player");
  const i = RATES.indexOf(v.playbackRate);
  const next =
    RATES[Math.min(Math.max((i < 0 ? 3 : i) + dir, 0), RATES.length - 1)];
  v.playbackRate = next;
}
function toggleFullscreen() {
  const v = $("#player");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else v.requestFullscreen?.().catch(() => {});
}
async function togglePiP() {
  const v = $("#player");
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled)
      await v.requestPictureInPicture();
  } catch {
    /* PiP unavailable in this browser — ignore */
  }
}
function toggleHelp(force) {
  const el = $("#shortcut-help");
  if (force === undefined) el.classList.toggle("hidden");
  else el.classList.toggle("hidden", !force);
}

document.addEventListener("keydown", (e) => {
  if (isTyping(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key;
  const lower = typeof key === "string" ? key.toLowerCase() : "";

  // "/" focuses search (grid only, when the player is closed)
  if (key === "/" && !isPlayerOpen()) {
    e.preventDefault();
    $("#search").focus();
    return;
  }

  if (key === "Escape") {
    if (!$("#shortcut-help").classList.contains("hidden")) toggleHelp(false);
    else if (isPlayerOpen()) closePlayer();
    else if (isSeriesOpen()) closeSeries();
    return;
  }

  if (!isPlayerOpen()) return;
  const v = $("#player");

  if (key === " " || lower === "k") {
    e.preventDefault();
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  } else if (lower === "m") {
    v.muted = !v.muted;
  } else if (lower === "j") {
    seekBy(-10);
  } else if (lower === "l") {
    seekBy(10);
  } else if (key === "ArrowLeft") {
    e.preventDefault();
    seekBy(-5);
  } else if (key === "ArrowRight") {
    e.preventDefault();
    seekBy(5);
  } else if (key === "ArrowUp") {
    e.preventDefault();
    setVolume(0.05);
  } else if (key === "ArrowDown") {
    e.preventDefault();
    setVolume(-0.05);
  } else if (key === "Home") {
    v.currentTime = 0;
  } else if (key === "End") {
    if (Number.isFinite(v.duration)) v.currentTime = v.duration;
  } else if (/^[0-9]$/.test(key)) {
    if (Number.isFinite(v.duration)) {
      v.currentTime = v.duration * (Number(key) / 10);
    }
  } else if (key === ",") {
    stepFrame(-1);
  } else if (key === ".") {
    stepFrame(1);
  } else if (key === "<") {
    changeRate(-1);
  } else if (key === ">") {
    changeRate(1);
  } else if (lower === "f") {
    toggleFullscreen();
  } else if (lower === "i") {
    togglePiP();
  } else if (lower === "n" && e.shiftKey) {
    playEpisodeAt(playCtx ? playCtx.index + 1 : 0);
  } else if (lower === "p" && e.shiftKey) {
    playEpisodeAt(playCtx ? playCtx.index - 1 : 0);
  } else if (key === "?") {
    toggleHelp();
  }
});

// ---------- Libraries / Settings ----------
async function loadLibraries() {
  const list = $("#lib-list");
  list.innerHTML = "";
  const { libraries } = await api("/api/libraries");
  if (!libraries.length) {
    list.innerHTML = '<li class="muted">No folders yet.</li>';
  }
  for (const lib of libraries) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="path">${escapeHtml(lib)}</span>`;
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
      await api("/api/libraries", {
        method: "DELETE",
        body: JSON.stringify({ dir: lib }),
      });
      loadLibraries();
      allMovies = [];
      activeLib = null;
      toast("🗑️ Folder removed", "info");
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function addLibrary(dir) {
  const msg = $("#lib-msg");
  msg.textContent = "";
  try {
    await api("/api/libraries", {
      method: "POST",
      body: JSON.stringify({ dir }),
    });
    $("#lib-input").value = "";
    $("#fs-browser").classList.add("hidden");
    loadLibraries();
    toast("✅ Folder added — open the Movies tab", "success");
    msg.textContent = "";
  } catch (e) {
    toast("⚠️ " + e.message, "error");
    msg.innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`;
  }
}

$("#add-lib-btn").addEventListener("click", () => {
  const dir = $("#lib-input").value.trim();
  if (dir) addLibrary(dir);
});
$("#lib-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#add-lib-btn").click();
});

// ---------- Folder browser ----------
$("#browse-btn").addEventListener("click", () => {
  $("#fs-browser").classList.toggle("hidden");
  if (!$("#fs-browser").classList.contains("hidden")) browseFs("");
});
$("#fs-close").addEventListener("click", () =>
  $("#fs-browser").classList.add("hidden"),
);

let fsCurrent = "";
async function browseFs(pathArg) {
  const data = await api("/api/fs?path=" + encodeURIComponent(pathArg));
  fsCurrent = data.current;
  $("#fs-current").textContent = data.current;
  const list = $("#fs-list");
  list.innerHTML = "";
  if (data.parent && data.parent !== data.current) {
    const up = document.createElement("li");
    up.className = "up";
    up.textContent = "⬆ ..";
    up.addEventListener("click", () => browseFs(data.parent));
    list.appendChild(up);
  }
  for (const d of data.dirs) {
    const li = document.createElement("li");
    li.textContent = "📁 " + d.name;
    li.addEventListener("click", () => browseFs(d.path));
    list.appendChild(li);
  }
}
$("#fs-pick").addEventListener("click", () => {
  if (fsCurrent) addLibrary(fsCurrent);
});

// ---------- Toast ----------
function toast(msg, type = "info") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

boot().catch((e) => {
  document.body.innerHTML = `<div class="screen center"><p class="error">Error: ${escapeHtml(e.message)}</p></div>`;
});
