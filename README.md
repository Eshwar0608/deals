# Local AI Reels Generator

A free, local-first MVP for generating short vertical reel videos without paid AI APIs such as Gemini or OpenAI.

The app can:

- Create a reel script from a topic using local Ollama when available
- Fall back to a built-in template generator when Ollama is not running
- Generate timed `.srt` captions
- Generate a local voiceover with Piper, espeak, or espeak-ng when available
- Render a downloadable 9:16 `.mp4` reel with FFmpeg
- Run as a Next.js website on your own machine

## Why this is free

This project avoids paid APIs. The cost is your own computer's CPU/RAM/GPU time. A machine with 16 GB RAM and a 500 GB SSD is enough for this prototype if you generate one short video at a time.

## Required software

Minimum:

- Node.js
- npm
- FFmpeg for MP4 rendering

Optional but recommended:

- Ollama for local script generation
- Piper TTS for better local voiceover
- espeak or espeak-ng as a basic voiceover fallback

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and generate a reel.

## Free local AI setup

### 1. Install Ollama and a small model

```bash
ollama pull llama3.2:3b
```

By default, the app calls:

```text
http://127.0.0.1:11434
```

You can change the model with:

```bash
export OLLAMA_MODEL=llama3.2:3b
```

If Ollama is slow on Windows ARM, increase the local request timeout before starting the app:

```powershell
$env:OLLAMA_TIMEOUT_MS="60000"
```

Disable Ollama and force the template fallback with:

```bash
export OLLAMA_DISABLED=1
```

### 2. Install FFmpeg

Ubuntu example:

```bash
sudo apt update
sudo apt install -y ffmpeg
```

If FFmpeg is missing or not on PATH, the app still creates scripts and captions, but it cannot render the MP4. Check with `ffmpeg -version`. The app also searches common Windows winget locations for `ffmpeg.exe` automatically. On Windows, if FFmpeg is installed in a custom location, set `FFMPEG_BIN` to the full `ffmpeg.exe` path before running `npm run dev`.

### 3. Optional voiceover

For a better local voice, install Piper and set a local voice model:

```bash
export PIPER_MODEL=/path/to/voice.onnx
```

For a simple fallback voice on Ubuntu:

```bash
sudo apt install -y espeak-ng
```

For Windows ARM / Snapdragon laptops, install eSpeak NG from PowerShell:

```powershell
winget install eSpeak-NG.eSpeak-NG
espeak-ng --version
```

The app automatically tries `espeak`, then `espeak-ng`. If your binary is installed in a custom location, set:

```powershell
$env:ESPEAK_BIN="C:\\Path\\To\\espeak-ng.exe"
```

If no TTS tool is available, the app renders a silent video with captions.

## Windows ARM quick setup

Open PowerShell as Administrator:

```powershell
irm https://ollama.com/install.ps1 | iex
ollama pull llama3.2:3b
winget install Gyan.FFmpeg
winget install eSpeak-NG.eSpeak-NG
npm install
npm run dev
```

Then open `http://localhost:3000`. Ollama handles the script, FFmpeg renders the MP4, and eSpeak NG provides the basic free voiceover.

If `ffmpeg -version` is not recognized after install, close and reopen PowerShell. The app will also try to discover winget-installed FFmpeg automatically. If winget says FFmpeg is installed but the app still cannot render MP4 files, set the path manually before starting the app:

```powershell
$env:FFMPEG_BIN="C:\\Path\\To\\ffmpeg.exe"
npm run dev
```

## How generation works

```text
Prompt/topic
-> Ollama local model or template fallback creates 6 caption lines
-> App creates timed SRT captions
-> Piper/espeak/espeak-ng creates a WAV voiceover if available
-> FFmpeg draws captions directly and renders a 1080x1920 vertical MP4
-> Browser shows preview and download links
```

Generated files are written to:

```text
public/generated/reels/<id>/
```

That folder is ignored by git because rendered videos can become large.

## Troubleshooting Windows FFmpeg subtitle path errors

Older versions of this app used FFmpeg's `subtitles` filter with an `.srt` path. On Windows, paths like `C:\Users\...` can be parsed incorrectly by that filter. The renderer now draws captions directly from the generated script segments, so pull the latest branch and clear `.next` if you see an `Unable to parse "original_size"` FFmpeg error.

## Troubleshooting Windows workspace root errors

If Next.js reports that it selected `C:\Users\<you>\package-lock.json` as the workspace root, or you see a React Client Manifest error, stop the dev server and remove the accidental parent lockfile and stale build cache:

```powershell
cd "C:\Users\manoj\OneDrive\Documents\GitHub\deals"
Remove-Item -Force "$HOME\package-lock.json" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run dev
```

The app also sets `turbopack.root` to the current project directory so Turbopack does not infer `C:\Users\<you>` as the root when another lockfile exists above the repo.

## Useful scripts

```bash
npm run dev      # start local dev server
npm run build    # production build check
npm run start    # run production server after build
npm run lint     # run ESLint
```

## Notes for improving the MVP

Good next upgrades that can still stay free/local:

- Add Pexels/Pixabay stock clip search for richer backgrounds
- Add template selection for education, fitness, business, and product reels
- Add a cleanup job for old generated videos
- Add user-uploaded clips/images
- Add local Whisper only when you need transcription from uploaded audio
