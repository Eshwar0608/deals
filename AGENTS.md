# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

**Local AI Reels Generator** — a single Next.js app (not a monorepo) that generates short vertical reel videos from a topic. Core flow: script → SRT captions → optional TTS → FFmpeg MP4 render.

## Standard commands (repo root)

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` → http://localhost:3000 |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Production | `npm run build` then `npm start` |

There is no `npm test` script or test runner in this repo.

## System dependencies

- **FFmpeg** — required for MP4 output. Without it, the API still returns script and `captions.srt`, but `videoUrl` is `null`.
- **Ollama** (optional) — local script generation at `http://127.0.0.1:11434`
- **Piper / espeak-ng** (optional) — voiceover
- **PEXELS_API_KEY / PIXABAY_API_KEY** (optional) — stock video backgrounds

See `README.md` for full setup and env var reference.

## Deterministic local testing

For reproducible dev/API checks without external services:

```bash
OLLAMA_DISABLED=1 STOCK_VIDEOS_DISABLED=1 REMOTE_IMAGES_DISABLED=1 npm run dev
```

Hello-world API check:

```bash
curl -s -X POST http://localhost:3000/api/reels \
  -H 'Content-Type: application/json' \
  -d '{"topic":"hello world dev setup","duration":15}'
```

Expect HTTP 200, a `script`, `segments`, and (with FFmpeg) a non-null `videoUrl` under `/generated/reels/<id>/`.

## Cursor Cloud specific instructions

- **Single service**: only the Next.js dev server must run for UI and API work. Use `npm run dev` from `/workspace` (port 3000).
- **FFmpeg on PATH**: Cloud VMs need `ffmpeg` installed at the OS level for end-to-end MP4 generation. It is not installed by `npm install`. Ubuntu: `sudo apt-get update && sudo apt-get install -y ffmpeg`.
- **Long-running dev server**: Start `npm run dev` in a **tmux** session so it survives backgrounding; reel generation can take up to several minutes (`maxDuration` 300s on `/api/reels`).
- **No Docker / database**: Nothing to `docker compose up`; no Postgres or Redis.
- **Lint/build**: `npm run lint` and `npm run build` are sufficient CI-style checks; there are no automated unit tests.
- **Generated artifacts**: Output is written to `public/generated/reels/<id>/` (gitignored). Clear old folders if disk space is tight.
- **Optional services**: Ollama, Piper, espeak, and stock APIs are optional; the app degrades to template script, silent video, and color/photo backgrounds. Use the env flags above when you want zero external network calls during testing.
