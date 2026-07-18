# 🎬 Mini-Stream

**🌐 Bahasa:** [English](README.md) · **Bahasa Indonesia**

Server streaming film **self-hosted** (mini Jellyfin) berbasis Node.js. Menampilkan
koleksi film MP4 dari folder di server sebagai grid poster, lalu memutarnya langsung
di browser dengan dukungan seek (HTTP Range streaming). Tanpa build step di frontend.

![stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express-06b6d4)

## ✨ Fitur
- 🔐 **Login 1 password** — di-setup sekali saat pertama kali dibuka
- 📁 **Kelola folder film lewat UI** (halaman Pengaturan) + file browser bawaan
- 🖼️ **Poster otomatis** — pakai gambar lokal (`poster.jpg`, `<nama>.jpg`, …) atau
  di-generate dari video via ffmpeg, lalu di-cache
- 🎨 **Thumbnail kustom** — upload banner/poster sendiri lewat menu ⋮ di tiap film
- ▶️ **Streaming dengan seek** (HTTP Range), judul dirapikan, durasi & ukuran file
- 📊 **Hero + statistik** (jumlah film, folder, total durasi, ukuran)
- 🔎 **Pencarian instan** + filter per folder
- 🌌 UI tema biru–cyan dengan skeleton loading & notifikasi toast

---

## 📦 Prasyarat

| Dependency | Wajib? | Fungsi |
|---|---|---|
| **Node.js 18+** (dites di v22) | ✅ Ya | Menjalankan server |
| **ffmpeg** & **ffprobe** | ⚠️ Disarankan | Generate poster & baca durasi otomatis. Tanpa ini, film tetap bisa diputar, tapi tanpa poster/durasi auto. |

### 1. Install Node.js
Cek apakah sudah ada:
```bash
node --version   # harus >= 18
```
Kalau belum:
- **Ubuntu / Debian:** `sudo apt update && sudo apt install -y nodejs npm`
  (atau via [nvm](https://github.com/nvm-sh/nvm) untuk versi terbaru)
- **macOS (Homebrew):** `brew install node`
- **Windows:** unduh installer di <https://nodejs.org>

### 2. Install ffmpeg (disarankan)
Cek dulu:
```bash
ffmpeg -version && ffprobe -version
```
Kalau belum:
- **Ubuntu / Debian:** `sudo apt install -y ffmpeg`
- **macOS (Homebrew):** `brew install ffmpeg`
- **Windows:** `winget install Gyan.FFmpeg` atau unduh di <https://ffmpeg.org/download.html>
  (pastikan folder `bin` masuk ke PATH)

---

## 🚀 Instalasi & Menjalankan

```bash
# 1. Masuk ke folder proyek
cd streaming

# 2. Install dependency Node (hanya Express)
npm install

# 3. Jalankan server
npm start
#   → buka http://localhost:3000

# Port lain:
PORT=8080 npm start

# Mode dev (auto-restart saat file berubah):
npm run dev
```

### Langkah pertama di browser
1. Buka `http://localhost:3000` → **buat password** (sekali saja, min. 4 karakter).
2. Masuk tab **Pengaturan** → tambahkan folder film (ketik path atau klik **Telusuri…**).
3. Buka tab **Film** untuk mulai menonton. Klik ⋮ pada poster untuk mengganti thumbnail.

---

## 🎞️ Format yang didukung
Streaming langsung di browser paling andal untuk **MP4 (H.264/AAC)**. Format
`.webm`, `.m4v`, `.mov` juga di-scan. `.mkv` sengaja **tidak** diaktifkan karena
umumnya tidak diputar native oleh browser (butuh transcoding — lihat roadmap).

---

## 🗂️ Struktur proyek
```
server.js          # Express + routing API
src/config.js      # config.json (password, daftar folder), path folder cache
src/auth.js        # password (scrypt) + session cookie
src/media.js       # scan, poster/thumbnail, ffprobe durasi, Range streaming
public/            # frontend (HTML/CSS/JS, tanpa build step)
  ├─ index.html
  ├─ css/style.css
  └─ js/app.js
data/              # dibuat otomatis, TIDAK di-commit (lihat .gitignore):
  ├─ config.json   #   password + daftar folder
  ├─ thumbs/       #   cache poster hasil generate
  ├─ custom/       #   poster/banner upload user
  └─ meta-cache.json  # cache durasi
```

---

## 🔧 Reset / Ganti password
Karena mode 1-password, reset dilakukan di server:
```bash
# hentikan server, lalu:
rm data/config.json
# jalankan lagi → layar "Buat password" muncul kembali
```
> Catatan: ini juga menghapus daftar folder library (perlu ditambahkan ulang).

## 🔒 Keamanan
- Semua request file divalidasi agar berada di dalam folder library (anti path
  traversal).
- Ditujukan untuk jaringan rumah/LAN. Untuk akses dari internet, taruh di
  belakang **reverse proxy + HTTPS** (mis. Nginx / Caddy).

## 🛣️ Roadmap
- Ganti password dari halaman Pengaturan (tanpa hapus config)
- **Transcoding** on-the-fly (mkv/codec tak didukung, subtitle) via ffmpeg
- **Metadata online** (poster & sinopsis dari TMDB)
- **Watch progress** & multi-user

## 📄 Lisensi
MIT — bebas digunakan & dimodifikasi.
