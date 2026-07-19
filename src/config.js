import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  passwordHash: null, // "salt:hash" (scrypt), null = not set up yet
  libraries: [],      // list of absolute movie folder paths
};

let cache = null;

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'thumbs'), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'custom'), { recursive: true });
}

export function thumbsDir() {
  return path.join(DATA_DIR, 'thumbs');
}

export function customDir() {
  return path.join(DATA_DIR, 'custom');
}

export function metaCachePath() {
  return path.join(DATA_DIR, 'meta-cache.json');
}

export function sessionsPath() {
  return path.join(DATA_DIR, 'sessions.json');
}

export async function loadConfig() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    cache = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULT_CONFIG };
  }
  return cache;
}

export async function saveConfig(next) {
  cache = { ...cache, ...next };
  await ensureDataDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

export async function getLibraries() {
  const cfg = await loadConfig();
  return cfg.libraries;
}

// Roots that the folder browser and library manager are allowed to touch.
// This is the guard that stops someone adding e.g. "/etc" as a library and
// reading arbitrary files. Override with MINISTREAM_ROOTS (a list of absolute
// paths separated by the OS path delimiter, ":" on Linux). Defaults to the
// current user's home directory.
export function allowedRoots() {
  const raw = process.env.MINISTREAM_ROOTS;
  const list = raw
    ? raw.split(path.delimiter).map((p) => p.trim()).filter(Boolean)
    : [os.homedir()];
  return list.map((p) => path.resolve(p));
}
