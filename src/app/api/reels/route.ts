import { NextResponse } from "next/server";

import { generateReel, normalizeReelInput } from "@/lib/reel-generator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const normalized = normalizeReelInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  try {
    const result = await generateReel(normalized.value);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate reel." },
      { status: 500 },
    );
  }
}
