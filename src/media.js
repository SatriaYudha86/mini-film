import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { getLibraries, thumbsDir, customDir, metaCachePath } from './config.js';

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov']);
const POSTER_NAMES = ['poster', 'folder', 'cover', 'movie'];
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const SKIP_DIRS = new Set(['node_modules', '.git', '@eaDir', '.thumbnails']);

// ---------- Path security ----------
// id = base64url of the absolute path. Always re-validated against the libraries.
export function encodeId(absPath) {
  return Buffer.from(absPath).toString('base64url');
}
export function decodeId(id) {
  try {
    return Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

// Ensure the target sits inside one of the library roots (prevents path traversal).
export async function assertInsideLibrary(absPath) {
  const libs = await getLibraries();
  let real;
  try {
    real = await fs.realpath(absPath);
  } catch {
    return false;
  }
  for (const lib of libs) {
    let libReal;
    try { libReal = await fs.realpath(lib); } catch { continue; }
    if (real === libReal || real.startsWith(libReal + path.sep)) return true;
  }
  return false;
}

// ---------- Title cleaning ----------
const TAG_RE = /\b(1080p|720p|2160p|480p|4k|x264|x265|h264|h265|hevc|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdrip|dvdrip|hdtv|xvid|aac|ac3|dts|hdr|remux|proper|repack|internal|amzn|nf|yify|yts|rarbg|ita|eng|multi)\b/gi;

export function cleanTitle(filename) {
  let name = filename.replace(/\.[^.]+$/, '');
  // Strip site prefixes (e.g. "Lk21.De-", "D21.FUN-") and long trailing numeric IDs
  name = name.replace(/^[A-Za-z0-9]+\.[A-Za-z0-9]+-/, '');
  name = name.replace(/-\d{8,}$/, '');
  name = name.replace(/[._]/g, ' ');
  const yearMatch = name.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  if (year) name = name.slice(0, name.indexOf(year));
  name = name.replace(TAG_RE, ' ');
  name = name.replace(/[\[\](){}]/g, ' ');
  name = name.replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/[-–\s]+$/, '').trim();
  if (!name) name = filename.replace(/\.[^.]+$/, '');
  return { title: name, year };
}

// ---------- Scanning ----------
async function walk(dir, root, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, root, out, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXT.has(ext)) out.push({ full, root });
    }
  }
}

// Return a list of items: standalone movies or series (groups of episodes).
// Rule: a file directly in a library root is a movie. Files in a subfolder are
// grouped per folder; >1 file becomes a series, a single file stays a movie.
export async function scanMovies() {
  const libs = await getLibraries();
  const files = [];
  for (const lib of libs) {
    await walk(lib, lib, files);
  }
  const meta = await loadMetaCache();

  const singles = [];           // { full, root } directly in a library root
  const groups = new Map();     // parentDir -> { root, parent, files: [] }
  for (const { full, root } of files) {
    const parent = path.dirname(full);
    if (parent === root) {
      singles.push({ full, root });
    } else {
      if (!groups.has(parent)) groups.set(parent, { root, parent, files: [] });
      groups.get(parent).files.push(full);
    }
  }

  const items = [];
  for (const { full, root } of singles) {
    items.push(await buildMovie(full, root, meta));
  }
  for (const { root, parent, files: gfiles } of groups.values()) {
    if (gfiles.length === 1) {
      items.push(await buildMovie(gfiles[0], root, meta));
    } else {
      items.push(await buildSeries(parent, root, gfiles, meta));
    }
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}

async function buildMovie(full, root, meta) {
  let stat;
  try { stat = await fs.stat(full); } catch { stat = { size: 0, mtimeMs: 0 }; }
  const { title, year } = cleanTitle(path.basename(full));
  return {
    type: 'movie',
    id: encodeId(full),
    posterId: encodeId(full),
    title,
    year,
    library: path.basename(root),
    size: stat.size,
    duration: meta[cacheKey(full, stat)]?.duration ?? null,
  };
}

async function buildSeries(folder, root, gfiles, meta) {
  const episodes = [];
  let totalSize = 0;
  for (const full of gfiles) {
    let stat;
    try { stat = await fs.stat(full); } catch { stat = { size: 0, mtimeMs: 0 }; }
    totalSize += stat.size;
    const ep = parseEpisode(path.basename(full));
    episodes.push({
      id: encodeId(full),
      title: ep.label,
      season: ep.season,
      episode: ep.episode,
      size: stat.size,
      duration: meta[cacheKey(full, stat)]?.duration ?? null,
    });
  }
  episodes.sort((a, b) =>
    (a.season - b.season) || (a.episode - b.episode) || a.title.localeCompare(b.title));
  const { title, year } = cleanTitle(path.basename(folder));
  return {
    type: 'series',
    id: encodeId(folder),
    posterId: episodes[0].id,   // poster taken from the first episode
    title,
    year,
    library: path.basename(root),
    episodeCount: episodes.length,
    size: totalSize,
    duration: null,
    episodes,
  };
}

// Extract season/episode from the filename for ordering and labels.
function pad(n) { return String(n).padStart(2, '0'); }
function parseEpisode(filename) {
  const name = filename.replace(/\.[^.]+$/, '');
  let m = name.match(/S(\d{1,2})\s*[.\-_ ]?E(\d{1,3})/i);
  if (m) {
    const s = +m[1], e = +m[2];
    return { season: s, episode: e, label: `S${pad(s)}E${pad(e)}` };
  }
  m = name.match(/\b(?:episode|ep|e)\s*[-_ ]?(\d{1,3})\b/i);
  if (m) {
    return { season: 1, episode: +m[1], label: `Episode ${pad(+m[1])}` };
  }
  m = name.match(/(\d{1,3})(?!.*\d)/); // last number as a fallback
  return { season: 1, episode: m ? +m[1] : 0, label: name };
}

// ---------- Metadata cache (durations) ----------
let metaCache = null;
function cacheKey(file, stat) {
  return crypto.createHash('md5').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex');
}
async function loadMetaCache() {
  if (metaCache) return metaCache;
  try {
    metaCache = JSON.parse(await fs.readFile(metaCachePath(), 'utf8'));
  } catch {
    metaCache = {};
  }
  return metaCache;
}
async function saveMetaCache() {
  try {
    await fs.writeFile(metaCachePath(), JSON.stringify(metaCache), 'utf8');
  } catch { /* ignore */ }
}

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      const val = parseFloat(out.trim());
      resolve(Number.isFinite(val) ? val : null);
    });
    p.on('error', () => resolve(null));
  });
}

export async function getDuration(file) {
  let stat;
  try { stat = await fs.stat(file); } catch { return null; }
  const cache = await loadMetaCache();
  const key = cacheKey(file, stat);
  if (cache[key]?.duration !== undefined) return cache[key].duration;
  const duration = await ffprobeDuration(file);
  cache[key] = { duration };
  await saveMetaCache();
  return duration;
}

// Compute durations for every uncached file (with limited concurrency).
export async function warmDurations(concurrency = 3) {
  const libs = await getLibraries();
  const files = [];
  for (const lib of libs) await walk(lib, lib, files);
  const queue = files.map((f) => f.full);
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const file = queue.shift();
      await getDuration(file);
    }
  });
  await Promise.all(workers);
}

// ---------- Thumbnail / poster ----------
async function findLocalPoster(videoFile) {
  const dir = path.dirname(videoFile);
  const base = path.basename(videoFile, path.extname(videoFile));
  const candidates = [];
  for (const ext of IMG_EXT) candidates.push(path.join(dir, base + ext));
  for (const name of POSTER_NAMES) {
    for (const ext of IMG_EXT) candidates.push(path.join(dir, name + ext));
  }
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* next */ }
  }
  return null;
}

function generateThumb(videoFile, outFile, seek) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', [
      '-ss', String(seek), '-i', videoFile,
      '-frames:v', '1', '-vf', 'scale=400:-1',
      '-y', outFile,
    ]);
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

// User-uploaded custom poster (always .jpg, keyed by the video path).
export function customPosterFile(videoFile) {
  const h = crypto.createHash('md5').update(videoFile).digest('hex');
  return path.join(customDir(), h + '.jpg');
}

// Save an uploaded image as the custom poster (normalised to jpg via ffmpeg).
export async function saveCustomPoster(videoFile, buffer) {
  const out = customPosterFile(videoFile);
  const tmp = out + '.tmp';
  await fs.writeFile(tmp, buffer);
  const ok = await new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-i', tmp, '-vf', 'scale=600:-1', '-q:v', '3', '-y', out]);
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
  if (!ok) {
    // Fallback: store the raw bytes if ffmpeg fails (e.g. already a jpg).
    await fs.copyFile(tmp, out).catch(() => {});
  }
  await fs.rm(tmp, { force: true }).catch(() => {});
  try { await fs.access(out); return true; } catch { return false; }
}

export async function removeCustomPoster(videoFile) {
  await fs.rm(customPosterFile(videoFile), { force: true }).catch(() => {});
}

// Return the poster image path (custom > local file > generated & cached).
export async function getThumbnail(videoFile) {
  const custom = customPosterFile(videoFile);
  try { await fs.access(custom); return { file: custom, generated: true }; } catch { /* next */ }

  const local = await findLocalPoster(videoFile);
  if (local) return { file: local, generated: false };

  let stat;
  try { stat = await fs.stat(videoFile); } catch { return null; }
  const key = cacheKey(videoFile, stat);
  const outFile = path.join(thumbsDir(), key + '.jpg');
  try { await fs.access(outFile); return { file: outFile, generated: true }; } catch { /* generate */ }

  const duration = await getDuration(videoFile);
  // seek ~20% in, but never past the end of the video (safe for short clips)
  const seek = duration && duration > 0
    ? Math.min(duration * 0.2, Math.max(duration - 0.5, 0))
    : 3;
  const ok = await generateThumb(videoFile, outFile, seek);
  // Make sure the file was actually created and is not empty before using it
  if (ok) {
    try {
      if ((await fs.stat(outFile)).size > 0) return { file: outFile, generated: true };
    } catch { /* file was not created */ }
  }
  await fs.rm(outFile, { force: true }).catch(() => {});
  return null;
}

// ---------- Range streaming ----------
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.webm': 'video/webm', '.mov': 'video/quicktime',
};

export async function streamVideo(req, res, file) {
  let stat;
  try { stat = await fs.stat(file); } catch {
    res.status(404).end('not found');
    return;
  }
  const total = stat.size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(file).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start) || start >= total) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;
  if (start > end) { start = 0; end = total - 1; }

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': type,
  });
  createReadStream(file, { start, end }).pipe(res);
}
