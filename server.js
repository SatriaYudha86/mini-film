import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ensureDataDir, loadConfig, saveConfig, getLibraries } from './src/config.js';
import {
  isConfigured, setupPassword, checkPassword,
  createSession, destroySession, getSessionToken, isValidSession,
  setSessionCookie, clearSessionCookie, requireAuth,
} from './src/auth.js';
import {
  scanMovies, decodeId, assertInsideLibrary,
  getThumbnail, streamVideo, getDuration, warmDurations,
  saveCustomPoster, removeCustomPoster,
} from './src/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = bisa diakses dari LAN
const app = express();

// Cari IP LAN untuk ditampilkan di log
function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth status & setup ----------
app.get('/api/status', async (req, res) => {
  res.json({
    configured: await isConfigured(),
    authenticated: isValidSession(getSessionToken(req)),
  });
});

app.post('/api/setup', async (req, res) => {
  if (await isConfigured()) return res.status(400).json({ error: 'sudah di-setup' });
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'password minimal 4 karakter' });
  }
  await setupPassword(password);
  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  if (!(await isConfigured())) return res.status(400).json({ error: 'belum di-setup' });
  const { password } = req.body || {};
  if (!(await checkPassword(password || ''))) {
    return res.status(401).json({ error: 'password salah' });
  }
  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Libraries (butuh auth) ----------
app.get('/api/libraries', requireAuth, async (req, res) => {
  res.json({ libraries: await getLibraries() });
});

app.post('/api/libraries', requireAuth, async (req, res) => {
  const { dir } = req.body || {};
  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ error: 'path tidak valid' });
  }
  const abs = path.resolve(dir);
  let stat;
  try { stat = await fs.stat(abs); } catch {
    return res.status(400).json({ error: 'folder tidak ditemukan: ' + abs });
  }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'bukan folder: ' + abs });

  const cfg = await loadConfig();
  if (cfg.libraries.includes(abs)) {
    return res.status(400).json({ error: 'folder sudah ada' });
  }
  cfg.libraries.push(abs);
  await saveConfig({ libraries: cfg.libraries });
  res.json({ libraries: cfg.libraries });
});

app.delete('/api/libraries', requireAuth, async (req, res) => {
  const { dir } = req.body || {};
  const cfg = await loadConfig();
  const next = cfg.libraries.filter((l) => l !== dir);
  await saveConfig({ libraries: next });
  res.json({ libraries: next });
});

// Bantu browsing folder di server untuk memilih path (butuh auth).
app.get('/api/fs', requireAuth, async (req, res) => {
  const dir = req.query.path ? path.resolve(String(req.query.path)) : path.parse(process.cwd()).root;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ current: dir, parent: path.dirname(dir), dirs });
  } catch (e) {
    res.status(400).json({ error: 'tidak bisa membaca folder' });
  }
});

// ---------- Movies ----------
app.get('/api/movies', requireAuth, async (req, res) => {
  try {
    res.json({ movies: await scanMovies() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/movie/:id', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).json({ error: 'akses ditolak' });
  }
  const duration = await getDuration(file);
  res.json({ id: req.params.id, duration });
});

app.get('/api/thumbnail/:id', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).end();
  }
  const thumb = await getThumbnail(file);
  if (!thumb) {
    res.status(404).sendFile(path.join(__dirname, 'public', 'placeholder.svg'));
    return;
  }
  // "no-cache" = browser boleh menyimpan, tapi WAJIB revalidasi dulu.
  // sendFile mengirim ETag + Last-Modified, jadi kalau poster tidak berubah
  // balasannya 304 (hemat), dan kalau diganti user langsung tampil baru.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(thumb.file);
});

// Upload poster/banner kustom (body = raw image)
app.post('/api/thumbnail/:id/upload',
  requireAuth,
  express.raw({ type: ['image/*'], limit: '20mb' }),
  async (req, res) => {
    const file = decodeId(req.params.id);
    if (!file || !(await assertInsideLibrary(file))) {
      return res.status(403).json({ error: 'akses ditolak' });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'gambar kosong / tipe tidak didukung' });
    }
    const ok = await saveCustomPoster(file, req.body);
    if (!ok) return res.status(500).json({ error: 'gagal menyimpan gambar' });
    res.json({ ok: true });
  });

// Hapus poster kustom (kembali ke poster otomatis)
app.delete('/api/thumbnail/:id/custom', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).json({ error: 'akses ditolak' });
  }
  await removeCustomPoster(file);
  res.json({ ok: true });
});

app.get('/api/stream/:id', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).end();
  }
  await streamVideo(req, res, file);
});

// ---------- Start ----------
const server = await (async () => {
  await ensureDataDir();
  await loadConfig();
  const s = app.listen(PORT, HOST, () => {
    const lan = lanAddress();
    console.log(`\n🎬  Mini-Stream berjalan (bind ${HOST}:${PORT})`);
    console.log(`    • Lokal   : http://localhost:${PORT}`);
    if (lan) console.log(`    • Jaringan: http://${lan}:${PORT}`);
    console.log('');
  });
  // Hitung durasi di background (tidak memblok startup).
  warmDurations().catch(() => {});
  return s;
})();

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
