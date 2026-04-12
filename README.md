# Video Captioner — Batch Multilingual Subtitle Generator

A local web tool that batch-generates multilingual subtitles for video files using cloud AI APIs. It transcribes speech with OpenAI Whisper (or Groq Whisper), then translates the resulting SRT files into your chosen target language — all through a browser-based interface with real-time progress tracking.

This is **not** a locally-run AI model. It calls paid (but fast) cloud APIs, so processing is quick and does not depend on your hardware specs.

## Who Is This For?

- **Teachers & students** — Convert an entire semester of lecture recordings into multilingual subtitles in one batch. A 50-hour Shakespeare course costs roughly **$18–20 USD** for transcription alone.
- **Content creators** — Add subtitles in multiple languages to video libraries.
- **Anyone with video files** — The tool processes any video format FFmpeg supports. This includes NSFW content — the tool makes no content judgments and works equally on any audio track.

## Features

- **Native directory picker** — Click "Choose Directory" to open your OS file browser; the tool scans for video and SRT files automatically.
- **Batch processing** — Checkbox to select multiple files; up to 3 processed in parallel.
- **Whisper model selection** — Choose between OpenAI `whisper-1` (large-v2), Groq `whisper-large-v3`, or Groq `whisper-large-v3-turbo`.
- **Translation model selection** — Pick from xAI Grok (4/3/3-mini/3-fast/2) or OpenAI GPT (5.4/4.1/4o and variants).
- **Target language** — Translate subtitles into Traditional Chinese, Simplified Chinese, English, Japanese, or Korean.
- **Multilingual UI** — Interface available in 繁中 / 简中 / English / 日本語 / 한국어.
- **Smart file grouping** — Videos are shown with their matching SRT files on the same row. Files without subtitles are highlighted; already-processed files are dimmed.
- **Translate-only mode** — Click any existing SRT tag to retranslate it into a different language without re-transcribing.
- **API key management** — Built-in settings panel to configure OpenAI, Groq, and xAI keys (saved to `.env`, hot-reloaded without restart).
- **Real-time progress** — Per-file progress bars with stage labels and start timestamps, powered by Server-Sent Events.

## How It Works — Technical Design

### Why a directory path instead of file upload?

Browsers cannot write files to arbitrary locations on disk. By having the user select a directory (via native OS picker or manual path input), the server reads videos directly from disk and **writes the generated SRT files back into the same directory** next to the original videos. No uploading, no downloading — just direct file I/O.

### Audio extraction

FFmpeg extracts audio from video as mono MP3 at 16 kHz / 64 kbps. This minimizes file size while preserving speech clarity for transcription.

### Whisper's 25 MB limit and parallel chunking

The Whisper API has a **25 MB per-request file size limit**. The tool automatically:

1. Checks the extracted audio file size
2. If over 24 MB, calculates how many chunks are needed and splits by duration using FFmpeg
3. Sends **all chunks in parallel** (`Promise.all`) to the Whisper API
4. Merges the returned segments with corrected time offsets into a single SRT

### SRT file naming convention

- Original transcription: `{video-name}-{detected-language}.srt` (e.g., `lecture-01-日語.srt`)
- Translation: `{video-name}-{target-language}.srt` (e.g., `lecture-01-中文(繁體).srt`, `lecture-01-English.srt`)

### Translation strategy

The entire SRT content is sent in **a single API call** when the subtitle count is under 100 entries. For larger files, it splits into batches of 100 entries and sends them **all in parallel**. This avoids the latency of sequential requests while staying within token limits.

### SSE heartbeat

A heartbeat comment is sent every 15 seconds on the Server-Sent Events connection to prevent proxy/browser timeouts during long API calls.

## Cost Awareness

These are **paid APIs**. While individual costs are low, they add up at scale:

| Service | Cost | Example |
|---------|------|---------|
| OpenAI Whisper | $0.006 / minute | 50 hours of lectures = ~$18 |
| Groq Whisper | Free tier available, then usage-based | Significantly cheaper for high volume |
| Translation (GPT-4o-mini) | ~$0.15 / 1M input tokens | A full SRT file is typically a few thousand tokens |
| Translation (Grok 3 Fast) | Varies by plan | Check xAI pricing |

**A 50-hour semester of lectures would cost roughly $18–20 for transcription alone** — affordable, but be mindful when processing large libraries.

Transcription and translation quality depend heavily on the **source audio quality**. Clear speech with minimal background noise produces the best results. Heavily compressed audio, music-heavy tracks, or overlapping speakers will degrade accuracy.

## Installation

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **FFmpeg** installed and available in PATH ([download](https://ffmpeg.org/download.html))

### macOS

```bash
# Install FFmpeg if not already installed
brew install ffmpeg

# Clone and install
git clone <repo-url> video-captioner
cd video-captioner
npm install

# Start
node server.js
# Open http://localhost:3000
```

### Windows

```powershell
# Install FFmpeg: download from https://ffmpeg.org/download.html
# Add ffmpeg.exe to your PATH

# Clone and install
git clone <repo-url> video-captioner
cd video-captioner
npm install

# Start
node server.js
# Open http://localhost:3000
```

### First-time setup

1. Open `http://localhost:3000`
2. Click the gear icon (top-left) to open Settings
3. Enter your API keys:
   - **OpenAI API Key** — required for Whisper transcription ([get one](https://platform.openai.com/api-keys))
   - **Groq API Key** — optional, for Whisper large-v3 models ([get one](https://console.groq.com/keys))
   - **xAI API Key** — for Grok translation models ([get one](https://console.x.ai/))
4. Click Save — keys are stored in `.env` and take effect immediately

### Cloud Deployment (Vercel, Railway, etc.)

> **Important limitation**: The directory picker and direct file I/O require the server to run on the **same machine** as the video files. Cloud deployment is possible but changes the workflow — you would need to either:
> - Mount a cloud storage volume (e.g., S3, GCS) and enter its mount path
> - Modify the tool to support file upload/download instead of direct disk access

For **Railway** or similar container hosts:

```bash
# Set environment variables in the dashboard:
# OPENAI_API_KEY=sk-...
# XAI_API_KEY=xai-...
# GROQ_API_KEY=gsk_...

# Deploy via Git push or CLI
railway up
```

For **Vercel**: The serverless function model is **not ideal** for this tool because:
- FFmpeg is not available in Vercel's runtime by default
- Serverless functions have a 10-second (free) or 60-second (pro) timeout — too short for video processing
- No persistent filesystem for reading/writing video files

**Recommended for cloud**: Use a VPS (DigitalOcean, Linode, AWS EC2) or a container platform (Railway, Fly.io, Render) where you have a persistent filesystem and can install FFmpeg.

## Project Structure

```
video-captioner/
  .env                 # API keys (auto-managed via Settings UI)
  .gitignore           # Excludes .env, node_modules, temp/
  package.json         # Dependencies
  server.js            # Express backend — API endpoints, FFmpeg, Whisper, translation
  public/
    index.html         # Single-page frontend — UI, i18n, progress tracking
```

## License

MIT

---

# Video Captioner — 批次多語字幕產生器

一個在本機運行的網頁工具，透過雲端 AI API 批次為影片檔案產生多語字幕。使用 OpenAI Whisper（或 Groq Whisper）轉錄語音，再將 SRT 字幕翻譯成指定的目標語言——全程透過瀏覽器介面操作，即時顯示處理進度。

這**不是**本機端的 AI 模型運算。它呼叫付費但快速的雲端 API，處理速度快，不依賴你的電腦硬體規格。

## 適用對象

- **老師與學生** — 將一整學期的課堂錄影批次轉成多語字幕。50 小時的莎士比亞課程，轉錄費用大約 **18–20 美元**。
- **內容創作者** — 為影片庫批量加上多國語言字幕。
- **任何有影片檔案的人** — 本工具處理 FFmpeg 支援的所有影片格式。NSFW 內容也不例外——工具不做內容審查，只要有音軌就能產生字幕。

## 功能特色

- **原生目錄選取器** — 點「選擇目錄」開啟系統檔案瀏覽器，自動掃描影片與 SRT 檔案。
- **批次處理** — 勾選多個檔案，最多 3 個同時並行處理。
- **Whisper 模型選擇** — OpenAI `whisper-1`（large-v2）、Groq `whisper-large-v3`、Groq `whisper-large-v3-turbo`。
- **翻譯模型選擇** — xAI Grok（4/3/3-mini/3-fast/2）或 OpenAI GPT（5.4/4.1/4o 及其變體）。
- **目標語言** — 翻譯成繁體中文、簡體中文、英文、日文或韓文。
- **多語系介面** — 繁中 / 简中 / English / 日本語 / 한국어 即時切換。
- **智慧檔案分組** — 影片與其對應的 SRT 同列顯示。無字幕的檔案醒目標示；已處理過的檔案淡化顯示。
- **純翻譯模式** — 點擊現有的 SRT 標籤，直接翻譯成另一種語言，無需重新轉錄。
- **API Key 管理** — 內建設定面板，可設定 OpenAI、Groq、xAI 金鑰（存入 `.env`，即時生效免重啟）。
- **即時進度追蹤** — 每個檔案獨立的進度條，顯示階段說明與開始時間戳記，透過 Server-Sent Events 推送。

## 技術設計

### 為什麼用目錄路徑而非檔案上傳？

瀏覽器無法將檔案寫入磁碟上的任意位置。讓使用者選擇目錄後，伺服器直接從磁碟讀取影片，並**將產生的 SRT 檔案寫回同一目錄**，放在原始影片旁邊。不需要上傳、不需要下載——直接檔案讀寫。

### 音訊提取

FFmpeg 將影片的音訊提取為單聲道 MP3（16 kHz / 64 kbps），在保持語音清晰度的同時最小化檔案大小。

### Whisper 的 25 MB 限制與平行分塊

Whisper API 有 **25 MB 的單次上傳限制**。工具會自動：

1. 檢查提取的音訊檔案大小
2. 若超過 24 MB，計算需要幾個分塊，用 FFmpeg 依時間切割
3. **全部分塊平行送出**（`Promise.all`）給 Whisper API
4. 將回傳的片段以校正後的時間偏移合併成一個完整的 SRT

### SRT 檔案命名原則

- 原始轉錄：`{影片名稱}-{偵測到的語言}.srt`（例如：`lecture-01-日語.srt`）
- 翻譯版本：`{影片名稱}-{目標語言}.srt`（例如：`lecture-01-中文(繁體).srt`、`lecture-01-English.srt`）

### 翻譯策略

字幕數量在 100 條以內時，整份 SRT 內容**一次送出**完成翻譯。超過 100 條時，切成每批 100 條並**全部平行送出**，避免逐次等待的延遲，同時控制在 token 上限內。

### SSE 心跳機制

每 15 秒在 Server-Sent Events 連線上發送心跳，防止長時間 API 呼叫時被 proxy 或瀏覽器超時切斷。

## 費用提醒

這些都是**付費 API**。單次費用低廉，但大量使用時會累積：

| 服務 | 費用 | 範例 |
|------|------|------|
| OpenAI Whisper | $0.006 / 分鐘 | 50 小時課程 ≈ $18 |
| Groq Whisper | 有免費額度，超額後按量計費 | 大量使用時明顯便宜 |
| 翻譯（GPT-4o-mini） | 約 $0.15 / 百萬輸入 token | 一份 SRT 通常只有幾千 token |
| 翻譯（Grok 3 Fast） | 依方案而異 | 請查 xAI 定價 |

**一學期 50 小時的課程，光轉錄就大約需要 18–20 美元**——很便宜，但處理大型影片庫時請留意費用。

轉錄與翻譯的品質高度依賴**原始音訊品質**。清晰的語音、低背景噪音能得到最佳結果。高度壓縮的音訊、音樂過多、或多人同時說話都會降低準確度。

## 安裝方式

### 前置需求

- **Node.js** 18+（[下載](https://nodejs.org/)）
- **FFmpeg** 已安裝並加入 PATH（[下載](https://ffmpeg.org/download.html)）

### macOS

```bash
# 安裝 FFmpeg
brew install ffmpeg

# 下載並安裝
git clone <repo-url> video-captioner
cd video-captioner
npm install

# 啟動
node server.js
# 開啟 http://localhost:3000
```

### Windows

```powershell
# 安裝 FFmpeg：從 https://ffmpeg.org/download.html 下載
# 將 ffmpeg.exe 加入系統 PATH

# 下載並安裝
git clone <repo-url> video-captioner
cd video-captioner
npm install

# 啟動
node server.js
# 開啟 http://localhost:3000
```

### 首次設定

1. 開啟 `http://localhost:3000`
2. 點左上角齒輪圖示開啟設定
3. 輸入你的 API Key：
   - **OpenAI API Key** — 轉錄必需（[申請](https://platform.openai.com/api-keys)）
   - **Groq API Key** — 選填，用於 Whisper large-v3 模型（[申請](https://console.groq.com/keys)）
   - **xAI API Key** — 用於 Grok 翻譯模型（[申請](https://console.x.ai/)）
4. 點儲存——金鑰存入 `.env`，立即生效

### 雲端部署（Vercel、Railway 等）

> **重要限制**：目錄選取與直接檔案讀寫需要伺服器與影片檔案在**同一台機器**上。雲端部署可行，但需要調整工作流程——你需要：
> - 掛載雲端儲存空間（如 S3、GCS）並輸入掛載路徑
> - 或修改工具改為支援檔案上傳/下載模式

**Railway** 或類似容器主機：

```bash
# 在後台設定環境變數：
# OPENAI_API_KEY=sk-...
# XAI_API_KEY=xai-...
# GROQ_API_KEY=gsk_...

# 透過 Git push 或 CLI 部署
railway up
```

**Vercel**：Serverless 函式模型**不太適合**本工具，因為：
- Vercel 預設環境沒有 FFmpeg
- Serverless 函式有 10 秒（免費）或 60 秒（Pro）的超時限制——不夠影片處理用
- 沒有持久性檔案系統可供讀寫影片

**雲端推薦**：使用 VPS（DigitalOcean、Linode、AWS EC2）或容器平台（Railway、Fly.io、Render），有持久檔案系統且可安裝 FFmpeg。

## 專案結構

```
video-captioner/
  .env                 # API 金鑰（透過設定介面管理）
  .gitignore           # 排除 .env、node_modules、temp/
  package.json         # 相依套件
  server.js            # Express 後端——API 端點、FFmpeg、Whisper、翻譯
  public/
    index.html         # 單頁前端——介面、多語系、進度追蹤
```

## 授權

MIT
