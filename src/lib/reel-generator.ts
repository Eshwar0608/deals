import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 12000);
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
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").replace(/["`#]/g, "").trim())
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
  if (!(await commandAvailable("ffmpeg", ["-version"]))) {
    warnings.push("FFmpeg is not installed, so the app generated the script and captions only.");
    return null;
  }

  const outputPath = path.join(outputDir, "reel.mp4");
  const palette = paletteForStyle(input.style);
  const captionFilter = [
    `subtitles=${captionsPath}:force_style='FontName=Arial,FontSize=72,PrimaryColour=&H00FFFFFF,OutlineColour=&HAA000000,BackColour=&H77000000,BorderStyle=4,Outline=2,Shadow=0,Alignment=2,MarginV=230'`,
    `drawbox=x=0:y=0:w=iw:h=220:color=${palette.accent}@0.28:t=fill`,
    `drawbox=x=0:y=1700:w=iw:h=220:color=${palette.accent}@0.18:t=fill`,
  ].join(",");

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
    "-c:v",
    "libx264",
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

  try {
    await runCommand("ffmpeg", args, undefined, 180000);
    return outputPath;
  } catch (error) {
    warnings.push(`FFmpeg render failed: ${error instanceof Error ? error.message : "unknown error"}. Script and captions were still generated.`);
    await writeFile(path.join(outputDir, "render-debug.json"), JSON.stringify({ input, segments, args }, null, 2));
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

