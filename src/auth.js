import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { loadConfig, saveConfig, sessionsPath } from './config.js';

// ---- Password hashing (scrypt) ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isConfigured() {
  const cfg = await loadConfig();
  return Boolean(cfg.passwordHash);
}

export async function setupPassword(password) {
  await saveConfig({ passwordHash: hashPassword(password) });
}

export async function checkPassword(password) {
  const cfg = await loadConfig();
  return verifyPassword(password, cfg.passwordHash);
}

// ---- Sessions (persisted to disk so a restart does not sign everyone out) ----
// Only the SHA-256 of each token is stored, so the file on disk cannot be used
// to hijack a session even if it is read.
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const sessions = new Map(); // sha256(token) -> expiry (ms)

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function loadSessions() {
  try {
    const raw = JSON.parse(await fs.readFile(sessionsPath(), 'utf8'));
    const now = Date.now();
    for (const [hash, exp] of Object.entries(raw)) {
      if (typeof exp === 'number' && exp > now) sessions.set(hash, exp);
    }
  } catch {
    /* no session file yet — start empty */
  }
}

// Fire-and-forget; callers do not need to await the write.
function persistSessions() {
  fs.writeFile(sessionsPath(), JSON.stringify(Object.fromEntries(sessions)), {
    encoding: 'utf8',
    mode: 0o600,
  }).catch(() => {});
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(tokenHash(token), Date.now() + SESSION_TTL);
  persistSessions();
  return token;
}

export function destroySession(token) {
  if (sessions.delete(tokenHash(token))) persistSessions();
}

export function isValidSession(token) {
  if (!token) return false;
  const hash = tokenHash(token);
  const exp = sessions.get(hash);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(hash);
    persistSessions();
    return false;
  }
  return true;
}

// ---- Login throttling (per client IP) ----
const MAX_ATTEMPTS = 5;              // failures allowed before a lockout
const ATTEMPT_WINDOW = 15 * 60_000;  // failures older than this are forgotten
const LOCK_TIME = 15 * 60_000;       // how long a lockout lasts
const attempts = new Map();          // ip -> { count, first, lockedUntil }

// Returns seconds remaining in a lockout, or 0 when the IP may try again.
export function loginLockRemaining(ip) {
  const rec = attempts.get(ip);
  if (!rec?.lockedUntil) return 0;
  const left = rec.lockedUntil - Date.now();
  if (left <= 0) {
    attempts.delete(ip);
    return 0;
  }
  return Math.ceil(left / 1000);
}

export function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > ATTEMPT_WINDOW) {
    attempts.set(ip, { count: 1, first: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = now + LOCK_TIME;
}

export function clearLoginAttempts(ip) {
  attempts.delete(ip);
}

// ---- Cookie helpers ----
function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => {
      const i = c.indexOf('=');
      if (i < 0) return [c.trim(), ''];
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(([k]) => k)
  );
}

export function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.sid;
}

// Add the Secure attribute when served over HTTPS (e.g. behind a TLS reverse
// proxy). Enable with SECURE_COOKIES=1 — do NOT set it for plain-HTTP access or
// the browser will refuse to send the cookie and logins will appear to fail.
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';
const secureAttr = SECURE_COOKIES ? ' Secure;' : '';

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly;${secureAttr} Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `sid=; HttpOnly;${secureAttr} Path=/; SameSite=Lax; Max-Age=0`);
}

// Middleware
export function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  if (isValidSession(token)) {
    req.sessionToken = token;
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}
