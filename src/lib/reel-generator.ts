import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_ROOT = path.join(process.cwd(), "public", "generated", "reels");
const SUPPORTED_DURATIONS = new Set([15, 30, 45, 60]);

type ScriptSource = "ollama" | "template";

type NormalizedInput = {
  topic: string;
  tone: string;
  duration: 15 | 30 | 45 | 60;
  style: string;
};

export type ReelSegment = {
  text: string;
  start: number;
  end: number;
};

export type ReelResult = {
  id: string;
  topic: string;
  tone: string;
  duration: number;
  style: string;
  source: ScriptSource;
  script: string;
  segments: ReelSegment[];
  videoUrl: string | null;
  audioUrl: string | null;
  files: {
    captions: string;
    script: string;
    video: string | null;
    audio: string | null;
  };
  warnings: string[];
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type StockVideoClip = {
  path: string;
  source: "pexels" | "pixabay";
  attribution: string;
  pageUrl: string;
};

type StockVideoCandidate = {
  source: "pexels" | "pixabay";
  id: string;
  downloadUrl: string;
  pageUrl: string;
  width: number;
  height: number;
  duration: number;
  attribution: string;
};

export function normalizeReelInput(body: unknown):
  | { ok: true; value: NormalizedInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be an object." };
  }

  const payload = body as Record<string, unknown>;
  const topic = cleanText(payload.topic, 140);
  const tone = cleanText(payload.tone, 40) || "energetic";
  const style = cleanText(payload.style, 60) || "modern creator";
  const duration = Number(payload.duration || 30);

  if (topic.length < 3) {
    return { ok: false, error: "Enter a topic with at least 3 characters." };
  }

  if (!SUPPORTED_DURATIONS.has(duration)) {
    return { ok: false, error: "Duration must be 15, 30, 45, or 60 seconds." };
  }

  return {
    ok: true,
    value: {
      topic,
      tone,
      duration: duration as NormalizedInput["duration"],
      style,
    },
  };
}

export async function generateReel(input: NormalizedInput): Promise<ReelResult> {
  const id = randomUUID();
  const warnings: string[] = [];
  const outputDir = path.join(OUTPUT_ROOT, id);
  await mkdir(outputDir, { recursive: true });

  const { lines, source } = await generateScriptLines(input, warnings);
  const segments = createSegments(lines, input.duration);
  const script = lines.join("\n");
  const captionsPath = path.join(outputDir, "captions.srt");
  const scriptPath = path.join(outputDir, "script.txt");

  await writeFile(captionsPath, buildSrt(segments), "utf8");
  await writeFile(scriptPath, script, "utf8");

  const audioPath = await createVoiceover(outputDir, script, warnings);
  const videoPath = await renderVideo(input, segments, captionsPath, outputDir, audioPath, warnings);
  const publicBase = `/generated/reels/${id}`;

  return {
    id,
    topic: input.topic,
    tone: input.tone,
    duration: input.duration,
    style: input.style,
    source,
    script,
    segments,
    videoUrl: videoPath ? `${publicBase}/reel.mp4` : null,
    audioUrl: audioPath ? `${publicBase}/voice.wav` : null,
    files: {
      captions: `${publicBase}/captions.srt`,
      script: `${publicBase}/script.txt`,
      video: videoPath ? `${publicBase}/reel.mp4` : null,
      audio: audioPath ? `${publicBase}/voice.wav` : null,
    },
    warnings,
  };
}

async function generateScriptLines(
  input: NormalizedInput,
  warnings: string[],
): Promise<{ lines: string[]; source: ScriptSource }> {
  if (process.env.OLLAMA_DISABLED !== "1") {
    try {
      const ollamaLines = await generateWithOllama(input);
      if (ollamaLines.length >= 4) {
        return { lines: ollamaLines, source: "ollama" };
      }
      warnings.push("Ollama replied, but not enough usable caption lines were returned. Used template fallback.");
    } catch (error) {
      warnings.push(`Ollama unavailable: ${error instanceof Error ? error.message : "unknown error"}. Used template fallback.`);
    }
  }

  return { lines: fallbackScript(input), source: "template" };
}

async function generateWithOllama(input: NormalizedInput): Promise<string[]> {
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${host.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        prompt: [
          `Create a ${input.duration}-second vertical Instagram reel script.`,
          `Topic: ${input.topic}`,
          `Tone: ${input.tone}`,
          `Visual style: ${input.style}`,
          "Return exactly 6 short caption lines.",
          "Do not use numbering, markdown, emojis, hashtags, or quotation marks.",
          "Each line must be under 85 characters and should read well as on-screen text.",
        ].join("\n"),
        options: {
          temperature: 0.75,
          num_predict: 220,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { response?: unknown };
    return cleanLines(String(data.response || ""));
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackScript(input: NormalizedInput): string[] {
  const topic = input.topic.replace(/[.!?]+$/g, "");
  const tone = input.tone.toLowerCase();
  const style = input.style.toLowerCase();

  const hook = tone.includes("funny")
    ? `Nobody tells you this about ${topic}`
    : tone.includes("calm")
      ? `Here is a simple way to understand ${topic}`
      : `Stop scrolling if you care about ${topic}`;

  return [
    hook,
    `Start with one clear idea, not ten different points`,
    `Show the result first so viewers know why it matters`,
    `Use quick cuts, bold captions, and a ${style} look`,
    `Give one practical tip people can try today`,
    `Save this reel and use it when you plan your next post`,
  ];
}

function cleanLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((line) => line
      .replace(/^\(?\s*\d+(?:\.\d+)?\s*s?\s*[-–]\s*\d+(?:\.\d+)?\s*s?\s*\)?\s*/i, "")
      .replace(/^\[?\s*\d{1,2}:\d{2}(?::\d{2})?\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]?\s*/i, "")
      .replace(/^[-*\d.)\s]+/, "")
      .replace(/["`#]/g, "")
      .replace(/['’‘]/g, "")
      .trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, 90))
    .slice(0, 6);
}

function createSegments(lines: string[], duration: number): ReelSegment[] {
  const segmentLength = duration / lines.length;
  return lines.map((text, index) => ({
    text,
    start: roundTime(index * segmentLength),
    end: roundTime(index === lines.length - 1 ? duration : (index + 1) * segmentLength),
  }));
}

function buildSrt(segments: ReelSegment[]): string {
  return segments
    .map((segment, index) => [
      String(index + 1),
      `${toSrtTimestamp(segment.start)} --> ${toSrtTimestamp(segment.end)}`,
      segment.text,
      "",
    ].join("\n"))
    .join("\n");
}

async function createVoiceover(
  outputDir: string,
  script: string,
  warnings: string[],
): Promise<string | null> {
  const audioPath = path.join(outputDir, "voice.wav");
  const narration = script.replace(/\n+/g, ". ");
  const piperModel = process.env.PIPER_MODEL;
  const piperBin = process.env.PIPER_BIN || "piper";

  if (piperModel) {
    try {
      await runCommand(piperBin, ["--model", piperModel, "--output_file", audioPath], narration, 120000);
      return audioPath;
    } catch (error) {
      warnings.push(`Piper voiceover failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  const espeakBin = await findAvailableCommand(
    [process.env.ESPEAK_BIN, "espeak", "espeak-ng"],
    ["--version"],
  );

  if (espeakBin) {
    try {
      await runCommand(espeakBin, ["-w", audioPath, narration], undefined, 90000);
      return audioPath;
    } catch (error) {
      warnings.push(`${espeakBin} voiceover failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  } else {
    warnings.push("No local TTS found. Install Piper for better voiceover, or espeak/espeak-ng for a basic free voice.");
  }

  return null;
}

async function renderVideo(
  input: NormalizedInput,
  segments: ReelSegment[],
  captionsPath: string,
  outputDir: string,
  audioPath: string | null,
  warnings: string[],
): Promise<string | null> {
  const ffmpegBin = await findFfmpegBinary();

  if (!ffmpegBin) {
    warnings.push("FFmpeg is not installed or is not on PATH. Install FFmpeg, restart your terminal, or set FFMPEG_BIN to the full ffmpeg.exe path.");
    return null;
  }

  const outputPath = path.join(outputDir, "reel.mp4");
  const palette = paletteForStyle(input.style);
  const captionFontFile = await findCaptionFontFile();

  if (!captionFontFile && process.platform === "win32") {
    warnings.push("No Windows caption font file was found. Set REEL_FONT_FILE to a .ttf font path if FFmpeg reports Fontconfig errors.");
  }

  const captionFilter = buildVideoFilter(input, segments, palette, captionFontFile);
  const stockClips = await downloadStockVideoClips(outputDir, input, segments, warnings);
  const imagePaths = stockClips.length > 0 ? [] : await downloadSceneImages(outputDir, input, segments, warnings);
  const args = stockClips.length > 0
    ? buildStockVideoRenderArgs(input, segments, stockClips, captionFilter, outputPath, audioPath)
    : imagePaths.length === segments.length
      ? buildImageRenderArgs(input, segments, imagePaths, captionFilter, outputPath, audioPath)
      : buildColorRenderArgs(input, palette, captionFilter, outputPath, audioPath);

  try {
    await runCommand(ffmpegBin, args, undefined, 180000);
    return outputPath;
  } catch (error) {
    warnings.push(`FFmpeg render failed: ${error instanceof Error ? error.message : "unknown error"}. Script and captions were still generated.`);
    await writeFile(path.join(outputDir, "render-debug.json"), JSON.stringify({ input, segments, captionsPath, args }, null, 2));
    return null;
  }
}

function paletteForStyle(style: string): { background: string; accent: string } {
  const lowered = style.toLowerCase();
  if (lowered.includes("cinematic")) return { background: "0x101018", accent: "0xf59e0b" };
  if (lowered.includes("minimal")) return { background: "0xf8fafc", accent: "0x0f172a" };
  if (lowered.includes("fitness")) return { background: "0x06120b", accent: "0x22c55e" };
  if (lowered.includes("luxury")) return { background: "0x120d07", accent: "0xd4af37" };
  return { background: "0x0f172a", accent: "0x38bdf8" };
}

function buildColorRenderArgs(
  input: NormalizedInput,
  palette: { background: string; accent: string },
  captionFilter: string,
  outputPath: string,
  audioPath: string | null,
): string[] {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${palette.background}:s=1080x1920:d=${input.duration}:r=30`,
  ];

  if (audioPath) {
    args.push("-i", audioPath);
  }

  args.push(
    "-vf",
    captionFilter,
    "-t",
    String(input.duration),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  );

  if (audioPath) {
    args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    args.push("-an");
  }

  args.push(outputPath);
  return args;
}

function buildStockVideoRenderArgs(
  input: NormalizedInput,
  segments: ReelSegment[],
  clips: StockVideoClip[],
  captionFilter: string,
  outputPath: string,
  audioPath: string | null,
): string[] {
  const sceneClips = segments.map((_, index) => clips[index % clips.length]);
  const args = ["-y"];

  for (let index = 0; index < sceneClips.length; index += 1) {
    const segmentDuration = Math.max(0.1, segments[index].end - segments[index].start);
    args.push("-stream_loop", "-1", "-t", String(segmentDuration), "-i", sceneClips[index].path);
  }

  if (audioPath) {
    args.push("-i", audioPath);
  }

  const preparedInputs = sceneClips
    .map((_, index) => {
      const segmentDuration = Math.max(0.1, segments[index].end - segments[index].start);
      return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,trim=duration=${segmentDuration},setpts=PTS-STARTPTS[v${index}]`;
    })
    .join(";");
  const concatInputs = sceneClips.map((_, index) => `[v${index}]`).join("");
  const filterComplex = `${preparedInputs};${concatInputs}concat=n=${sceneClips.length}:v=1:a=0,format=yuv420p[base];[base]${captionFilter}[v]`;

  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
  );

  if (audioPath) {
    args.push("-map", `${sceneClips.length}:a:0`, "-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    args.push("-an");
  }

  args.push(
    "-t",
    String(input.duration),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  );

  return args;
}

function buildImageRenderArgs(
  input: NormalizedInput,
  segments: ReelSegment[],
  imagePaths: string[],
  captionFilter: string,
  outputPath: string,
  audioPath: string | null,
): string[] {
  const args = ["-y"];

  for (let index = 0; index < imagePaths.length; index += 1) {
    const segmentDuration = Math.max(0.1, segments[index].end - segments[index].start);
    args.push("-loop", "1", "-t", String(segmentDuration), "-i", imagePaths[index]);
  }

  if (audioPath) {
    args.push("-i", audioPath);
  }

  const preparedInputs = imagePaths
    .map((_, index) => `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v${index}]`)
    .join(";");
  const concatInputs = imagePaths.map((_, index) => `[v${index}]`).join("");
  const filterComplex = `${preparedInputs};${concatInputs}concat=n=${imagePaths.length}:v=1:a=0,format=yuv420p[base];[base]${captionFilter}[v]`;

  args.push(
    "-filter_complex",
    filterComplex,
    "-map",
    "[v]",
  );

  if (audioPath) {
    args.push("-map", `${imagePaths.length}:a:0`, "-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    args.push("-an");
  }

  args.push(
    "-t",
    String(input.duration),
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  );

  return args;
}

function buildVideoFilter(
  input: NormalizedInput,
  segments: ReelSegment[],
  palette: { background: string; accent: string },
  fontFile: string | null,
): string {
  const filters = [
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.34:t=fill",
    `drawbox=x=0:y=0:w=iw:h=170:color=${palette.accent}@0.46:t=fill`,
    "drawbox=x=70:y=1738:w=940:h=14:color=white@0.25:t=fill",
  ];

  for (const segment of segments) {
    const enable = ffmpegEnable(segment);
    const caption = normalizeCaptionForRender(segment.text);
    const visualTitle = extractVisualTitle(segment.text, input.topic);
    const captionSize = caption.length > 70 ? 46 : caption.length > 52 ? 52 : 58;

    filters.push(
      `drawbox=x=70:y=1110:w=940:h=500:color=black@0.66:t=fill:enable=${enable}`,
      `drawbox=x=90:y=1130:w=900:h=6:color=${palette.accent}@0.98:t=fill:enable=${enable}`,
      `${buildDrawTextPrefix(fontFile, visualTitle)}:fontcolor=white:fontsize=82:line_spacing=14:x=(w-text_w)/2:y=690:enable=${enable}`,
      `${buildDrawTextPrefix(fontFile, `SCENE ${String(segments.indexOf(segment) + 1).padStart(2, "0")}`)}:fontcolor=white@0.86:fontsize=34:x=92:y=66:enable=${enable}`,
      `${buildDrawTextPrefix(fontFile, wrapCaptionText(caption, 24, 4))}:fontcolor=white:fontsize=${captionSize}:line_spacing=12:box=0:x=(w-text_w)/2:y=1235:fix_bounds=1:enable=${enable}`,
    );
  }

  return filters.join(",");
}

function buildDrawTextPrefix(fontFile: string | null, text: string): string {
  const fontOption = fontFile ? `fontfile='${escapeFilterPath(fontFile)}':` : "";
  return `drawtext=${fontOption}text='${escapeDrawText(text)}'`;
}

function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");
}

function wrapCaptionText(text: string, maxLineLength = 28, maxLines = 3): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines).join("\n");
}

function normalizeCaptionForRender(text: string): string {
  return text
    .replace(/[’‘']/g, "")
    .replace(/[“”"]/g, "")
    .replace(/#/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVisualTitle(segmentText: string, topic: string): string {
  const source = normalizeCaptionForRender(segmentText.length > 18 ? segmentText : topic);
  const words = source
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 4);

  const title = words.length > 0 ? words.join(" ") : "Fresh Reel Idea";
  return wrapCaptionText(title.toUpperCase(), 15, 2);
}

function ffmpegEnable(segment: ReelSegment): string {
  return `'between(t\\,${segment.start}\\,${segment.end})'`;
}

function escapeDrawText(text: string): string {
  return text
    .replace(/['’‘]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

async function downloadStockVideoClips(
  outputDir: string,
  input: NormalizedInput,
  segments: ReelSegment[],
  warnings: string[],
): Promise<StockVideoClip[]> {
  if (process.env.STOCK_VIDEOS_DISABLED === "1") {
    return [];
  }

  const candidates = await searchStockVideoCandidates(input, warnings);
  if (candidates.length === 0) {
    if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
      warnings.push("No stock video API key configured. Add PEXELS_API_KEY or PIXABAY_API_KEY for topic-matched background videos.");
    }
    return [];
  }

  const selected = selectStockVideoCandidates(candidates, Math.min(segments.length, 6));
  const clips: StockVideoClip[] = [];
  const attributionLines: string[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const clipPath = path.join(outputDir, `stock-${index + 1}-${candidate.source}.mp4`);

    try {
      await downloadBinaryFile(candidate.downloadUrl, clipPath, 25000);
      clips.push({
        path: clipPath,
        source: candidate.source,
        attribution: candidate.attribution,
        pageUrl: candidate.pageUrl,
      });
      attributionLines.push(`${index + 1}. ${candidate.attribution} (${candidate.source}) - ${candidate.pageUrl}`);
    } catch (error) {
      warnings.push(`Could not download ${candidate.source} stock video ${index + 1}: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  if (attributionLines.length > 0) {
    await writeFile(path.join(outputDir, "stock-sources.txt"), attributionLines.join("\n"), "utf8");
  }

  if (clips.length === 0 && candidates.length > 0) {
    warnings.push("Stock video search found results, but none could be downloaded. Used photo fallback.");
  }

  return clips;
}

async function searchStockVideoCandidates(
  input: NormalizedInput,
  warnings: string[],
): Promise<StockVideoCandidate[]> {
  const query = buildStockVideoQuery(input.topic);
  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;

  if (pexelsKey) {
    const pexels = await searchPexelsVideos(query, pexelsKey, warnings);
    if (pexels.length > 0) {
      return pexels;
    }
  }

  if (pixabayKey) {
    const pixabay = await searchPixabayVideos(query, pixabayKey, warnings);
    if (pixabay.length > 0) {
      return pixabay;
    }
  }

  return [];
}

async function searchPexelsVideos(
  query: string,
  apiKey: string,
  warnings: string[],
): Promise<StockVideoCandidate[]> {
  try {
    const url = new URL("https://api.pexels.com/videos/search");
    url.searchParams.set("query", query);
    url.searchParams.set("orientation", "portrait");
    url.searchParams.set("per_page", "15");

    const response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      videos?: Array<{
        id: number;
        url: string;
        duration?: number;
        user?: { name?: string; url?: string };
        video_files?: Array<{
          id?: number;
          quality?: string;
          file_type?: string;
          width?: number;
          height?: number;
          link?: string;
        }>;
      }>;
    };

    return (data.videos || [])
      .flatMap((video) => {
        const bestFile = selectBestPexelsFile(video.video_files || []);
        if (!bestFile?.link) return [];
        const photographer = video.user?.name || "Pexels creator";
        return [{
          source: "pexels" as const,
          id: String(video.id),
          downloadUrl: bestFile.link,
          pageUrl: video.url,
          width: bestFile.width || 0,
          height: bestFile.height || 0,
          duration: video.duration || 0,
          attribution: `Video by ${photographer} on Pexels`,
        }];
      });
  } catch (error) {
    warnings.push(`Pexels video search failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    return [];
  }
}

async function searchPixabayVideos(
  query: string,
  apiKey: string,
  warnings: string[],
): Promise<StockVideoCandidate[]> {
  try {
    const url = new URL("https://pixabay.com/api/videos/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("q", query);
    url.searchParams.set("video_type", "film");
    url.searchParams.set("safesearch", "true");
    url.searchParams.set("per_page", "20");

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as {
      hits?: Array<{
        id: number;
        pageURL?: string;
        user?: string;
        duration?: number;
        videos?: Record<string, { url?: string; width?: number; height?: number; size?: number }>;
      }>;
    };

    return (data.hits || [])
      .flatMap((video) => {
        const bestFile = selectBestPixabayFile(video.videos || {});
        if (!bestFile?.url) return [];
        return [{
          source: "pixabay" as const,
          id: String(video.id),
          downloadUrl: bestFile.url,
          pageUrl: video.pageURL || "https://pixabay.com/videos/",
          width: bestFile.width || 0,
          height: bestFile.height || 0,
          duration: video.duration || 0,
          attribution: `Video by ${video.user || "Pixabay creator"} on Pixabay`,
        }];
      });
  } catch (error) {
    warnings.push(`Pixabay video search failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    return [];
  }
}

function selectBestPexelsFile(
  files: Array<{ file_type?: string; width?: number; height?: number; link?: string; quality?: string }>,
): { width?: number; height?: number; link?: string } | null {
  return files
    .filter((file) => file.link && (!file.file_type || file.file_type.includes("mp4")))
    .sort((a, b) => stockCandidateScore(b.width || 0, b.height || 0) - stockCandidateScore(a.width || 0, a.height || 0))[0] || null;
}

function selectBestPixabayFile(
  files: Record<string, { url?: string; width?: number; height?: number; size?: number }>,
): { url?: string; width?: number; height?: number } | null {
  return Object.values(files)
    .filter((file) => file.url)
    .sort((a, b) => stockCandidateScore(b.width || 0, b.height || 0) - stockCandidateScore(a.width || 0, a.height || 0))[0] || null;
}

function selectStockVideoCandidates(candidates: StockVideoCandidate[], count: number): StockVideoCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.downloadUrl)) return false;
      seen.add(candidate.downloadUrl);
      return true;
    })
    .sort((a, b) => stockCandidateScore(b.width, b.height) - stockCandidateScore(a.width, a.height))
    .slice(0, count);
}

function stockCandidateScore(width: number, height: number): number {
  const isPortrait = height >= width;
  const resolution = width * height;
  return resolution + (isPortrait ? 10_000_000 : 0);
}

function buildStockVideoQuery(topic: string): string {
  const cleaned = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 5)
    .join(" ")
    .trim();

  return cleaned || topic.slice(0, 60) || "nature travel";
}

async function downloadBinaryFile(url: string, filePath: string, timeoutMs: number): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 1024) {
    throw new Error("downloaded file was too small");
  }

  await writeFile(filePath, buffer);
}

const STOP_WORDS = new Set([
  "about",
  "with",
  "this",
  "that",
  "your",
  "from",
  "into",
  "reel",
  "video",
  "short",
  "create",
  "make",
  "tips",
  "idea",
  "ideas",
  "best",
  "good",
]);

async function downloadSceneImages(
  outputDir: string,
  input: NormalizedInput,
  segments: ReelSegment[],
  warnings: string[],
): Promise<string[]> {
  if (process.env.REMOTE_IMAGES_DISABLED === "1") {
    return [];
  }

  const paths: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const seed = encodeURIComponent(`${input.topic}-${input.style}-${index}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80));
    const imagePath = path.join(outputDir, `scene-${index + 1}.jpg`);

    try {
      const response = await fetch(`https://picsum.photos/seed/${seed}/1080/1920`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(imagePath, buffer);
      paths.push(imagePath);
    } catch (error) {
      warnings.push(`Could not download free background image ${index + 1}: ${error instanceof Error ? error.message : "unknown error"}. Used generated background instead.`);
      return [];
    }
  }

  return paths;
}

async function findCaptionFontFile(): Promise<string | null> {
  const explicit = process.env.REEL_FONT_FILE;
  if (explicit && await fileExists(explicit)) {
    return explicit;
  }

  const windowsDir = process.env.WINDIR || "C:\\Windows";
  const candidates = process.platform === "win32"
    ? [
        path.join(windowsDir, "Fonts", "arial.ttf"),
        path.join(windowsDir, "Fonts", "arialbd.ttf"),
        path.join(windowsDir, "Fonts", "segoeui.ttf"),
        path.join(windowsDir, "Fonts", "seguisb.ttf"),
        "C:\\Windows\\Fonts\\arial.ttf",
      ]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
      ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function findFfmpegBinary(): Promise<string | null> {
  const explicit = process.env.FFMPEG_BIN;
  const pathCandidates = [explicit, "ffmpeg", "ffmpeg.exe"];

  const availableFromPath = await findAvailableCommand(pathCandidates, ["-version"]);
  if (availableFromPath) {
    return availableFromPath;
  }

  if (process.platform !== "win32") {
    return null;
  }

  const fileCandidates = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "ffmpeg", "bin", "ffmpeg.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "ffmpeg", "bin", "ffmpeg.exe"),
  ].filter(Boolean) as string[];

  for (const candidate of fileCandidates) {
    if (await fileExists(candidate) && await commandAvailable(candidate, ["-version"])) {
      return candidate;
    }
  }

  const wingetRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
    : null;

  if (wingetRoot) {
    const discovered = await findFileByName(wingetRoot, "ffmpeg.exe", 350);
    for (const candidate of discovered) {
      if (await commandAvailable(candidate, ["-version"])) {
        return candidate;
      }
    }
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(rootDir: string, fileName: string, maxDirs: number): Promise<string[]> {
  const matches: string[] = [];
  const queue = [rootDir];
  let visited = 0;

  while (queue.length > 0 && visited < maxDirs) {
    const current = queue.shift();
    if (!current) continue;
    visited += 1;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        matches.push(fullPath);
      } else if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return matches;
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await runCommand(command, args, undefined, 6000);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableCommand(
  candidates: Array<string | undefined>,
  probeArgs: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await commandAvailable(candidate, probeArgs)) {
      return candidate;
    }
  }

  return null;
}

function runCommand(
  command: string,
  args: string[],
  input?: string,
  timeoutMs = 120000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-700)}`));
      }
    });

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toSrtTimestamp(value: number): string {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":") + `,${String(ms).padStart(3, "0")}`;
}

