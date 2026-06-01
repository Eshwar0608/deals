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

If FFmpeg is missing, the app still creates scripts and captions, but it cannot render the MP4.

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

## How generation works

```text
Prompt/topic
-> Ollama local model or template fallback creates 6 caption lines
-> App creates timed SRT captions
-> Piper/espeak/espeak-ng creates a WAV voiceover if available
-> FFmpeg renders a 1080x1920 vertical MP4
-> Browser shows preview and download links
```

Generated files are written to:

```text
public/generated/reels/<id>/
```

That folder is ignored by git because rendered videos can become large.

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
