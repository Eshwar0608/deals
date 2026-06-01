"use client";

import { FormEvent, useMemo, useState } from "react";

type ReelResult = {
  id: string;
  topic: string;
  tone: string;
  duration: number;
  style: string;
  source: "ollama" | "template";
  script: string;
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

type FormState = {
  topic: string;
  tone: string;
  duration: string;
  style: string;
};

const initialForm: FormState = {
  topic: "5 healthy breakfast ideas for busy students",
  tone: "energetic",
  duration: "30",
  style: "modern creator",
};

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<ReelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const canGenerate = useMemo(() => form.topic.trim().length >= 3 && !isGenerating, [form.topic, isGenerating]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: form.topic,
          tone: form.tone,
          duration: Number(form.duration),
          style: form.style,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Generation failed.");
      }

      setResult(payload as ReelResult);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">Free local-first MVP</div>
        <div className="heroGrid">
          <div>
            <h1>Generate reel videos with local AI tools.</h1>
            <p className="lead">
              Enter a topic, let Ollama or the built-in template create the reel script, and render a
              vertical MP4 with FFmpeg. No Gemini, OpenAI, or paid API is required.
            </p>
            <div className="badges" aria-label="Supported tools">
              <span>Ollama optional</span>
              <span>Piper or espeak optional</span>
              <span>FFmpeg renderer</span>
              <span>9:16 MP4</span>
            </div>
          </div>
          <div className="phonePreview" aria-label="Reel preview mockup">
            <div className="phoneBar" />
            <div className="previewCaption">Stop scrolling if you care about better reels</div>
            <div className="previewMeta">30s vertical reel</div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <form className="panel formPanel" onSubmit={handleSubmit}>
          <div>
            <p className="sectionLabel">Create a reel</p>
            <h2>Prompt settings</h2>
          </div>

          <label>
            Reel topic
            <textarea
              value={form.topic}
              onChange={(event) => setForm({ ...form, topic: event.target.value })}
              placeholder="Example: 3 tips to save money as a beginner freelancer"
              rows={4}
            />
          </label>

          <div className="fieldGrid">
            <label>
              Tone
              <select value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })}>
                <option value="energetic">Energetic</option>
                <option value="funny">Funny</option>
                <option value="calm educational">Calm educational</option>
                <option value="premium">Premium</option>
                <option value="fitness coach">Fitness coach</option>
              </select>
            </label>

            <label>
              Length
              <select
                value={form.duration}
                onChange={(event) => setForm({ ...form, duration: event.target.value })}
              >
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="45">45 seconds</option>
                <option value="60">60 seconds</option>
              </select>
            </label>
          </div>

          <label>
            Visual style
            <select value={form.style} onChange={(event) => setForm({ ...form, style: event.target.value })}>
              <option value="modern creator">Modern creator</option>
              <option value="cinematic">Cinematic</option>
              <option value="minimal clean">Minimal clean</option>
              <option value="fitness neon">Fitness neon</option>
              <option value="luxury">Luxury</option>
            </select>
          </label>

          <button type="submit" disabled={!canGenerate}>
            {isGenerating ? "Generating reel..." : "Generate free reel"}
          </button>

          <p className="hint">
            Best free setup: run Ollama locally for scripts, Piper for natural voice, and FFmpeg for the MP4.
            If Ollama or TTS is missing, this app still creates a script/caption fallback.
          </p>
        </form>

        <section className="panel resultPanel" aria-live="polite">
          <div>
            <p className="sectionLabel">Output</p>
            <h2>Your generated reel</h2>
          </div>

          {isGenerating && (
            <div className="loadingBox">
              <div className="spinner" />
              <p>Rendering can take a little while on CPU-only machines.</p>
            </div>
          )}

          {error && <div className="errorBox">{error}</div>}

          {!isGenerating && !error && !result && (
            <div className="emptyState">
              <p>Generated scripts, captions, audio, and video links will appear here.</p>
            </div>
          )}

          {result && (
            <div className="resultStack">
              <div className="statusRow">
                <span>Script source: {result.source === "ollama" ? "Local Ollama" : "Template fallback"}</span>
                <span>{result.duration}s</span>
              </div>

              {result.videoUrl ? (
                <video className="videoPlayer" src={result.videoUrl} controls playsInline />
              ) : (
                <div className="emptyState">
                  <p>No MP4 was rendered. Install FFmpeg locally, then generate again.</p>
                </div>
              )}

              <div className="scriptBox">
                <h3>Caption script</h3>
                <pre>{result.script}</pre>
              </div>

              <div className="actions">
                {result.videoUrl && <a href={result.videoUrl} download>Download MP4</a>}
                <a href={result.files.script} download>Download script</a>
                <a href={result.files.captions} download>Download captions</a>
                {result.audioUrl && <a href={result.audioUrl} download>Download voiceover</a>}
              </div>

              {result.warnings.length > 0 && (
                <div className="warningBox">
                  <h3>Setup notes</h3>
                  <ul>
                    {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </section>

      <section className="setup panel">
        <p className="sectionLabel">Local free tools</p>
        <h2>Recommended install checklist</h2>
        <div className="setupGrid">
          <article>
            <h3>1. Script AI</h3>
            <p>Install Ollama and pull a small model such as llama3.2:3b, qwen2.5:3b, or phi3.</p>
            <code>ollama pull llama3.2:3b</code>
          </article>
          <article>
            <h3>2. Voice</h3>
            <p>Use Piper for a better local voice. espeak also works as a basic fallback.</p>
            <code>export PIPER_MODEL=/path/to/voice.onnx</code>
          </article>
          <article>
            <h3>3. Render</h3>
            <p>Install FFmpeg so the backend can create downloadable 9:16 MP4 reels.</p>
            <code>ffmpeg -version</code>
          </article>
        </div>
      </section>
    </main>
  );
}
