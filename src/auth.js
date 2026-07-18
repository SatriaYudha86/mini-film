import crypto from 'node:crypto';
import { loadConfig, saveConfig } from './config.js';

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

// ---- Sessions (in-memory token store) ----
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 hari
const sessions = new Map(); // token -> expiry (ms)

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

export function destroySession(token) {
  sessions.delete(token);
}

export function isValidSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
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

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
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
