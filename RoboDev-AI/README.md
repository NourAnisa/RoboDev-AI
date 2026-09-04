# 🤖 RoboDev AI - Smart Roblox Studio AI Assistant

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey?style=for-the-badge)](#-persyaratan-sistem)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge)](RoboDev-AI/LICENSE)

**RoboDev AI** adalah asisten AI cerdas untuk Roblox Studio yang menghubungkan AI modern (**DeepSeek, ChatGPT, Google Gemini, Antigravity, 9Router, Kimi, GLM, Qwen, Arena, dan Meta AI**) langsung ke dalam Roblox Studio di komputer Anda.

Dengan RoboDev AI, Anda dapat membangun game, menulis dan mengedit script Luau modern (`--!strict`), menginspeksi hierarki instance Roblox, menjalankan Luau secara instan, dan menyimpan memori project — semuanya langsung melalui obrolan AI biasa tanpa perlu coding manual yang rumit!

---

## 🌟 Fitur Utama & Keunggulan Cerdas

1. **🤖 Dukungan Multi-Provider AI**:
   - **DeepSeek** (`chat.deepseek.com`, sangat direkomendasikan & gratis)
   - **ChatGPT** (`chatgpt.com`)
   - **Google Gemini** (`gemini.google.com`)
   - **Antigravity IDE (Google DeepMind Agentic Coding)**
   - **9Router / Custom AI Gateway** (Proxy multi-model fleksibel)
   - **Kimi, GLM (Z.ai), Qwen, Arena, Meta AI**
2. **🛡️ Standar Luau Modern & Server-Authoritative**:
   - Skrip yang dihasilkan mematuhi standar `--!strict` typing.
   - Menggunakan `task.wait`, `task.spawn`, dan `task.delay` (menghindari deprecated wait/spawn).
   - Penulisan skrip aman dengan validasi sisi server (Server-Authoritative) untuk RemoteEvent dan RemoteFunction.
3. **⚡ Antigravity & Studio MCP Integration**:
   - Plugin MCP siap pakai untuk Google Antigravity tersedia di `.agents/plugins/roblox-studio/`.
   - Agen dapat mengeksekusi Luau real-time, membaca pohon Explorer, serta mendiagnosis error runtime secara otomatis.
4. **🧠 Rich Project Memory**:
   - Menyimpan konteks, arsitektur, dan riwayat modifikasi game langsung di dalam file game Roblox Anda.
5. **🔍 Smart Error Diagnostics**:
   - AI membaca log konsol Roblox Studio untuk mendeteksi error runtime dan segera memperbaikinya secara otonom.

---

## 🏗️ Arsitektur & Cara Kerja

```
┌──────────────────────────────────────────────────────────────┐
│  AI Interface (Web Browser / Antigravity Agent / 9Router)     │
└──────────────────────────────┬───────────────────────────────┘
                               │ (WebSocket / HTTP)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  RoboDev AI Extension & Python Bridge (127.0.0.1)            │
└──────────────────────────────┬───────────────────────────────┘
                               │ (Model Context Protocol / MCP)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Roblox Studio (Place / DataModel / Scripts / Workspace)     │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 Persyaratan Sistem

- **Sistem Operasi**: Windows 10/11 atau macOS
- **Roblox Studio** (dengan dukungan fitur MCP Server bawaan)
- **Browser**: Google Chrome, Microsoft Edge, Brave, atau browser berbasis Chromium lainnya
- **Python**: Versi 3.9 atau lebih baru ([Unduh Python](https://www.python.org/downloads/))

---

## 🚀 Tutorial & Panduan Penggunaan Lengkap

Ikuti 4 langkah mudah di bawah ini untuk mulai menggunakan RoboDev AI:

### Langkah 1: Pasang Ekstensi di Browser

1. Buka browser Chromium Anda (Chrome, Edge, atau Brave).
2. Masuk ke halaman pengelolaan ekstensi:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
3. Aktifkan saklar **Developer mode** (Mode Pengembang) di pojok kanan atas.
4. Klik tombol **Load unpacked** (Muat yang belum dibongkar).
5. Pilih folder:
   ```
   RoboDev-AI/zeroscript-extension
   ```
6. Ekstensi **RoboDev AI** sekarang telah terpasang di browser Anda.

---

### Langkah 2: Aktifkan MCP Server di Roblox Studio

1. Buka aplikasi **Roblox Studio** dan buka game (Place) yang ingin Anda buat atau edit.
2. Di menu bagian atas Studio, klik tombol **Assistant** (AI Assistant).
3. Pada panel Assistant yang muncul di kanan, klik ikon **...** (titik tiga) di pojok kanan atas panel.
4. Pilih **Manage MCP Servers**.
5. Centang / klik **Enable Studio as MCP Server**.
6. Biarkan Roblox Studio tetap terbuka di latar belakang.

---

### Langkah 3: Jalankan RoboDev AI Bridge

Bridge Python bertugas menghubungkan ekstensi AI di browser ke Roblox Studio.

- **Untuk Windows**:
  - Masuk ke folder `RoboDev-AI`
  - Klik dua kali file **`start.bat`** (atau jalankan perintah `python bridge.py`)
- **Untuk macOS**:
  - Masuk ke folder `RoboDev-AI`
  - Klik dua kali file **`MacOS_Start.command`**  
    *(Jika muncul notifikasi keamanan macOS: Buka System Settings > Privacy & Security > klik Open Anyway)*

Sebuah jendela terminal/command prompt akan terbuka dan menunjukkan status Bridge telah aktif dan siap menerima koneksi.

---

### Langkah 4: Mulai Sesi Pembuatan Game dengan AI

1. Buka website AI pilihan Anda:
   - [DeepSeek Chat](https://chat.deepseek.com) *(Sangat Direkomendasikan)*
   - [ChatGPT](https://chatgpt.com)
   - [Google Gemini](https://gemini.google.com)
   - [Kimi AI](https://www.kimi.ai)
2. Buka obrolan baru (**New Chat**).
3. Bilah kontrol **RoboDev AI** akan otomatis muncul tepat di atas kolom chat.
4. Cek warna lampu indikator:
   - 🟢 **Hijau (Ready)**: Bridge dan Roblox Studio terhubung sempurna.
   - 🟡 **Kuning**: Bridge aktif, namun Roblox Studio belum dibuka atau MCP Server di Studio belum diaktifkan.
   - ⚪ **Abu-abu**: Bridge belum dijalankan (jalankan `start.bat`).
5. Klik tombol **Start session** (Mulai Sesi).
6. Tuliskan apa yang ingin Anda buat di Roblox Studio!

---

## 💬 Contoh Prompt / Perintah yang Bisa Dicoba

Ketikkan perintah langsung dalam bahasa Indonesia atau Inggris:

- *"Buatkan sistem Leaderstats (Koin & Level) lengkap dengan DataStore2 yang aman dan auto-save."*
- *"Buat arena pertempuran bertema sci-fi dengan sistem respawn pemain dan efek partikel saat menang."*
- *"Periksa semua script di ServerScriptService, cari bug yang mungkin ada, dan perbaiki sesuai kaidah Luau modern."*
- *"Buat sistem quest harian dengan UI interaktif di ScreenGui."*
- *"Buat pintu otomatis yang hanya terbuka jika pemain memiliki kunci atau level tertentu."*

---

## ⚡ Integrasi Khusus

### 1. Integrasi Google Antigravity Agent
RoboDev AI menyertakan plugin MCP siap pakai untuk Google Antigravity:
- Folder plugin terletak di `.agents/plugins/roblox-studio/`.
- File konfigurasi: `mcp_config.json` dan launcher: `launch_studio_mcp.py`.
- Aturan Luau modern terdaftar di `.agents/plugins/roblox-studio/rules/AGENTS.md`.

### 2. Integrasi 9Router / Custom AI Gateway
- Klik tombol **Switch AI** atau ikon menu di bilah bar RoboDev AI.
- Aktifkan opsi **9Router / Custom Gateway**.
- Masukkan URL endpoint 9Router lokal/remote Anda (contoh: `http://localhost:8080/v1`) untuk merutekan request ke model AI lokal atau self-hosted.

---

## ❓ Solusi Masalah Umum (Troubleshooting)

| Masalah | Penyebab | Solusi |
| :--- | :--- | :--- |
| **Indikator Abu-Abu (Offline)** | Bridge Python belum aktif | Jalankan `start.bat` di Windows atau `MacOS_Start.command` di macOS. |
| **Indikator Kuning** | Roblox Studio belum siap | Buka Place di Studio, lalu aktifkan MCP: `Assistant > ... > Manage MCP Servers > Enable Studio as MCP Server`. |
| **AI Menjawab dengan Teks Biasa** | Sesi belum dimulai | Pastikan Anda menekan tombol **Start session** di bilah bar sebelum mengirim pesan ke AI. |
| **Gagal Menjalankan Python** | Python belum ada di PATH | Unduh Python 3.9+ dari [python.org](https://www.python.org/) dan pastikan mencentang opsi *"Add python.exe to PATH"* saat instalasi. |

---

## 📜 Lisensi

Proyek ini bersifat open-source dan dilisensikan di bawah [GPL-3.0 License](RoboDev-AI/LICENSE).  
Dikelola dan dikembangkan oleh [NourAnisa](https://github.com/NourAnisa/RoboDev-AI).
