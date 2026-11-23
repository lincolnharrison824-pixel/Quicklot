// POST /api/listing
// Writes one Marketplace description for a signed-in QuickLot user.
// Body: { car: Car, tone: "friendly" | "direct" | "energy" }
// Header: Authorization: Bearer <Supabase access token>

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT, buildUserMessage, sanitize, type Car, type Tone } from "@/lib/prompt";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const DAILY_LIMIT = Number(process.env.DAILY_LISTING_LIMIT || 40);
// Written listings per person per calendar month (UTC). Keeps one heavy user from running up the bill.
const MONTHLY_LIMIT = Number(process.env.MONTHLY_LISTING_LIMIT || 400);
// The writer model. Haiku is plenty for a short listing and costs a small fraction of Opus.
// Set WRITER_MODEL on Vercel to switch back (for example to claude-opus-5-5) without a code change.
const WRITER_MODEL = process.env.WRITER_MODEL || "claude-haiku-5-5";
// Models that support the server-side refusal fallback.
const HAS_SERVER_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(WRITER_MODEL);

function cors(origin: string | null): Record<string, string> {
  // Only the Chrome extension calls this API. Every call also needs a valid sign-in token.
  const allowed = origin && origin.startsWith("chrome-extension://") ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

function reply(origin: string | null, status: number, body: unknown) {
  return Response.json(body, { status, headers: cors(origin) });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !process.env.ANTHROPIC_API_KEY) {
    return reply(origin, 500, { error: "The server is missing its settings. See SETUP.md, step 4." });
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(origin, 401, { error: "Please sign in again." });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return reply(origin, 401, { error: "Please sign in again." });
  const userId = userData.user.id;

  let body: { car?: Car; tone?: Tone; instructions?: string; previous?: string };
  try {
    body = await req.json();
  } catch {
    return reply(origin, 400, { error: "Bad request." });
  }
  const car = body.car;
  const tone: Tone = body.tone === "direct" || body.tone === "energy" ? body.tone : "friendly";
  const instructions = typeof body.instructions === "string" ? body.instructions.slice(0, 400) : "";
  const previous = typeof body.previous === "string" ? body.previous.slice(0, 2000) : "";
  if (!car || !car.make || !car.model) return reply(origin, 400, { error: "Missing car details." });

  // Daily limit on AI-written listings, counted per user (rows are protected by row level security).
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("listing_generations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfDay.toISOString());
  if ((count || 0) >= DAILY_LIMIT) {
    return reply(origin, 429, { error: `You've hit today's limit of ${DAILY_LIMIT} written listings.` });
  }
  const startOfMonth = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth(), 1));
  const { count: monthCount } = await supabase
    .from("listing_generations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfMonth.toISOString());
  if ((monthCount || 0) >= MONTHLY_LIMIT) {
    return reply(origin, 429, { error: `You've hit this month's limit of ${MONTHLY_LIMIT} written listings.` });
  }

  const client = new Anthropic();
  const userMessage = buildUserMessage(car, tone, instructions, previous);
  const write = (model: string, withFallback: boolean) =>
    client.beta.messages.create({
      model,
      max_tokens: 4000,
      output_config: { effort: "low" },
      // On models that support it, a declined request is retried on a fallback model inside the same call.
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  let text = "";
  try {
    let response = await write(WRITER_MODEL, HAS_SERVER_FALLBACK);
    // Haiku has no server-side fallback, so retry a declined request once on Opus.
    if (response.stop_reason === "refusal" && !HAS_SERVER_FALLBACK) {
      response = await write("claude-opus-5-5", true);
    }
    console.log(
      JSON.stringify({ event: "listing", model: response.model, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }),
    );

    if (response.stop_reason === "refusal") {
      return reply(origin, 422, { error: "The writer couldn't write this one. Use the basic version instead." });
    }
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return reply(origin, 503, { error: "The writer is busy. Try again in a minute." });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return reply(origin, 500, { error: "The server's AI key isn't working. See SETUP.md, step 4." });
    }
    if (error instanceof Anthropic.APIError) {
      return reply(origin, 502, { error: `The writer had a problem (${error.status}). Try again.` });
    }
    return reply(origin, 502, { error: "The writer had a problem. Try again." });
  }

  const description = sanitize(text, car);
  if (!description) return reply(origin, 502, { error: "The writer came back empty. Try again." });

  await supabase.from("listing_generations").insert({ user_id: userId, vin: car.vin || null, tone });

  return reply(origin, 200, { description });
}
