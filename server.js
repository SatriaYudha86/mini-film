import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ensureDataDir, loadConfig, saveConfig, getLibraries, allowedRoots } from './src/config.js';
import {
  isConfigured, setupPassword, checkPassword,
  createSession, destroySession, getSessionToken, isValidSession,
  setSessionCookie, clearSessionCookie, requireAuth,
  loadSessions, loginLockRemaining, recordFailedLogin, clearLoginAttempts,
} from './src/auth.js';
import {
  scanMovies, decodeId, assertInsideLibrary, isInsideRoots, isSupportedImage,
  getThumbnail, streamVideo, getDuration, warmDurations,
  saveCustomPoster, removeCustomPoster,
} from './src/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = reachable from the LAN
const MIN_PASSWORD = 8;
const app = express();

// Find the LAN IP to show in the startup log
function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// Do not advertise the framework/version.
app.disable('x-powered-by');
// Honour X-Forwarded-* only when explicitly placed behind a trusted proxy, so
// per-IP login throttling keeps working correctly. Set e.g. TRUST_PROXY=1.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

// Security headers on every response (defence-in-depth if an XSS ever slips in).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data:",          // posters + the inline SVG favicon
    "media-src 'self'",              // video streaming
    "style-src 'self' 'unsafe-inline'", // stylesheet + JS-set inline styles
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// True for requests that originate from the machine itself (loopback).
function isLoopback(req) {
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ---------- Auth status & setup ----------
app.get('/api/status', async (req, res) => {
  res.json({
    configured: await isConfigured(),
    authenticated: isValidSession(getSessionToken(req)),
  });
});

app.post('/api/setup', async (req, res) => {
  if (await isConfigured()) return res.status(400).json({ error: 'already set up' });
  // Only the first person to reach an unconfigured server can set the password.
  // Restrict that to the local machine so a stranger on the LAN cannot grab it
  // first. Set ALLOW_LAN_SETUP=1 to permit setup from other devices.
  if (!isLoopback(req) && process.env.ALLOW_LAN_SETUP !== '1') {
    return res.status(403).json({ error: 'setup is only allowed from the server itself' });
  }
  const { password } = req.body || {};
  if (!password || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD} characters` });
  }
  await setupPassword(password);
  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  if (!(await isConfigured())) return res.status(400).json({ error: 'not set up yet' });

  // Throttle brute-force attempts per client IP.
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const lockedFor = loginLockRemaining(ip);
  if (lockedFor > 0) {
    res.setHeader('Retry-After', String(lockedFor));
    return res.status(429).json({
      error: `too many attempts — try again in ${Math.ceil(lockedFor / 60)} minute(s)`,
    });
  }

  const { password } = req.body || {};
  if (!(await checkPassword(password || ''))) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'wrong password' });
  }
  clearLoginAttempts(ip);
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

// ---------- Libraries (auth required) ----------
app.get('/api/libraries', requireAuth, async (req, res) => {
  res.json({ libraries: await getLibraries() });
});

app.post('/api/libraries', requireAuth, async (req, res) => {
  const { dir } = req.body || {};
  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ error: 'invalid path' });
  }
  const abs = path.resolve(dir);
  // Keep libraries inside the allowed roots so nobody can add e.g. "/etc" and
  // read arbitrary files through the stream/thumbnail endpoints.
  if (!(await isInsideRoots(abs, allowedRoots()))) {
    return res.status(403).json({ error: 'folder is outside the allowed media roots' });
  }
  let stat;
  try { stat = await fs.stat(abs); } catch {
    return res.status(400).json({ error: 'folder not found: ' + abs });
  }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'not a folder: ' + abs });

  const cfg = await loadConfig();
  if (cfg.libraries.includes(abs)) {
    return res.status(400).json({ error: 'folder already added' });
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

// Helper to browse server folders when picking a path (auth required).
app.get('/api/fs', requireAuth, async (req, res) => {
  const roots = allowedRoots();
  // Default to the first allowed root instead of the filesystem root, and refuse
  // to browse anywhere outside the allowed roots.
  const dir = req.query.path ? path.resolve(String(req.query.path)) : roots[0];
  if (!(await isInsideRoots(dir, roots))) {
    return res.status(403).json({ error: 'path is outside the allowed media roots' });
  }
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Only offer the parent when it, too, stays inside an allowed root.
    const up = path.dirname(dir);
    const parent = (await isInsideRoots(up, roots)) ? up : dir;
    res.json({ current: dir, parent, dirs });
  } catch (e) {
    res.status(400).json({ error: 'cannot read folder' });
  }
});

// ---------- Movies ----------
app.get('/api/movies', requireAuth, async (req, res) => {
  try {
    res.json({ movies: await scanMovies() });
  } catch (e) {
    console.error('scanMovies failed:', e);
    res.status(500).json({ error: 'failed to scan libraries' });
  }
});

app.get('/api/movie/:id', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).json({ error: 'access denied' });
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
  // "no-cache" = the browser may store it, but MUST revalidate first.
  // sendFile sends ETag + Last-Modified, so an unchanged poster
  // answers 304 (cheap), while a replaced one shows up immediately.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(thumb.file);
});

// Upload a custom poster/banner (body = raw image)
app.post('/api/thumbnail/:id/upload',
  requireAuth,
  express.raw({ type: ['image/*'], limit: '20mb' }),
  async (req, res) => {
    const file = decodeId(req.params.id);
    if (!file || !(await assertInsideLibrary(file))) {
      return res.status(403).json({ error: 'access denied' });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'empty image / unsupported type' });
    }
    // Verify the bytes really are an image before handing them to ffmpeg.
    if (!isSupportedImage(req.body)) {
      return res.status(400).json({ error: 'unsupported image format' });
    }
    const ok = await saveCustomPoster(file, req.body);
    if (!ok) return res.status(500).json({ error: 'failed to save image' });
    res.json({ ok: true });
  });

// Remove the custom poster (fall back to the automatic one)
app.delete('/api/thumbnail/:id/custom', requireAuth, async (req, res) => {
  const file = decodeId(req.params.id);
  if (!file || !(await assertInsideLibrary(file))) {
    return res.status(403).json({ error: 'access denied' });
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
  await loadSessions(); // restore sign-ins from the previous run
  const s = app.listen(PORT, HOST, () => {
    const lan = lanAddress();
    console.log(`\n🎬  Mini-Stream berjalan (bind ${HOST}:${PORT})`);
    console.log(`    • Lokal   : http://localhost:${PORT}`);
    if (lan) console.log(`    • Jaringan: http://${lan}:${PORT}`);
    console.log(`    • Media roots: ${allowedRoots().join(', ')}`);
    if (process.env.SECURE_COOKIES !== '1') {
      console.log('    ⚠  HTTP polos: pasang TLS reverse proxy lalu set SECURE_COOKIES=1.');
    }
    console.log('');
  });
  // Compute durations in the background (does not block startup).
  warmDurations().catch(() => {});
  return s;
})();

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
