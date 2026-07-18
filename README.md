# 🎬 Mini-Stream
A **self-hosted** movie streaming server (a mini Jellyfin) built with Node.js. It
shows your MP4 collection from folders on the server as a poster grid, and plays
them straight in the browser with seeking support (HTTP Range streaming). No
frontend build step.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-06b6d4)

## ✨ Features
- 🔐 **Single-password login** — set up once on first launch
- 📁 **Manage library folders from the UI** (Settings page) + built-in file browser
- 🖼️ **Automatic posters** — use a local image (`poster.jpg`, `<name>.jpg`, …) or
  generate one from the video via ffmpeg, then cache it
- 🎨 **Custom thumbnails** — upload your own banner/poster from the ⋮ menu on each movie
- ▶️ **Streaming with seek** (HTTP Range), cleaned-up titles, duration & file size
- 📊 **Hero + stats** (movie count, folders, total duration, size)
- 🔎 **Instant search** + per-folder filtering
- 🌌 Blue–cyan themed UI with skeleton loading & toast notifications

---

## 📦 Requirements

| Dependency | Required? | Purpose |
|---|---|---|
| **Node.js 18+** (tested on v22) | ✅ Yes | Runs the server |
| **ffmpeg** & **ffprobe** | ⚠️ Recommended | Auto-generate posters & read durations. Without them, movies still play — just no auto poster/duration. |

### 1. Install Node.js
Check if it's already installed:
```bash
node --version   # must be >= 18
```
If not:
- **Ubuntu / Debian:** `sudo apt update && sudo apt install -y nodejs npm`
  (or use [nvm](https://github.com/nvm-sh/nvm) for the latest version)
- **macOS (Homebrew):** `brew install node`
- **Windows:** download the installer at <https://nodejs.org>

### 2. Install ffmpeg (recommended)
Check first:
```bash
ffmpeg -version && ffprobe -version
```
If not:
- **Ubuntu / Debian:** `sudo apt install -y ffmpeg`
- **macOS (Homebrew):** `brew install ffmpeg`
- **Windows:** `winget install Gyan.FFmpeg` or download at <https://ffmpeg.org/download.html>
  (make sure the `bin` folder is on your PATH)

---

## 🚀 Install & Run

```bash
# 1. Enter the project folder
cd streaming

# 2. Install Node dependencies (just Express)
npm install

# 3. Start the server
npm start
#   → open http://localhost:3000

# Different port:
PORT=8080 npm start

# Dev mode (auto-restart on file changes):
npm run dev
```

### First steps in the browser
1. Open `http://localhost:3000` → **create a password** (once, min. 4 characters).
2. Go to the **Settings** tab → add a movie folder (type a path or click **Browse…**).
3. Open the **Movies** tab and start watching. Click ⋮ on a poster to change its thumbnail.

---

## 🎞️ Supported formats
In-browser playback is most reliable with **MP4 (H.264/AAC)**. `.webm`, `.m4v`, and
`.mov` are also scanned. `.mkv` is intentionally **not** enabled because browsers
usually can't play it natively (needs transcoding — see roadmap).

---

## 🗂️ Project structure
```
server.js          # Express + API routing
src/config.js      # config.json (password, folder list), cache folder paths
src/auth.js        # password (scrypt) + session cookie
src/media.js       # scan, poster/thumbnail, ffprobe duration, Range streaming
public/            # frontend (HTML/CSS/JS, no build step)
  ├─ index.html
  ├─ css/style.css
  └─ js/app.js
data/              # auto-created, NOT committed (see .gitignore):
  ├─ config.json   #   password + folder list
  ├─ thumbs/       #   generated poster cache
  ├─ custom/       #   user-uploaded posters
  └─ meta-cache.json  # duration cache
```

---

## 🔧 Reset / change password
Since it's single-password mode, reset is done on the server:
```bash
# stop the server, then:
rm data/config.json
# start again → the "create password" screen reappears
```
> Note: this also clears the library folder list (you'll need to re-add them).

## 🔒 Security
- Every file request is validated to stay inside a library folder (path-traversal safe).
- Intended for home/LAN networks. For internet access, put it behind a
  **reverse proxy + HTTPS** (e.g. Nginx / Caddy).

## 🛣️ Roadmap
- Change password from the Settings page (without wiping config)
- **On-the-fly transcoding** (unsupported mkv/codecs, subtitles) via ffmpeg
- **Online metadata** (posters & synopsis from TMDB)
- **Watch progress** & multi-user

## 📄 License
MIT — free to use & modify.
