// Echo's server. Runs on Vercel. API keys live ONLY here (environment variables),
// so users of the website never see them.
const crypto = require("crypto");
const SYSTEM_PROMPT = require("./_prompt.js");

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const MAX_MESSAGES = 20;
const MAX_TEXT = 8000;
const MAX_TOKENS = 1500;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

class UserError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

function sameSecret(a, b) {
  const ha = crypto.createHash("sha256").update(String(a || "")).digest();
  const hb = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Check the incoming chat, keep the last few turns, and merge back-to-back turns
// from the same side so both AI providers accept the list.
function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new UserError("No message received.");
  const out = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    let text = typeof m.text === "string" ? m.text.slice(0, MAX_TEXT) : "";
    let image = null;
    if (m.image && typeof m.image.data === "string" && IMAGE_TYPES.includes(m.image.mime)) {
      image = { mime: m.image.mime, data: m.image.data };
    }
    if (!text.trim() && !image) continue;
    if (!text.trim() && image) text = "Please look at this photo.";
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.text += "\n\n" + text;
      if (image) last.images.push(image);
    } else {
      out.push({ role: m.role, text, images: image ? [image] : [] });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") {
    throw new UserError("Last message must be from the user.");
  }
  return out;
}

async function readError(r) {
  try {
    const d = await r.json();
    return (d && d.error && (d.error.message || d.error)) || "";
  } catch (e) {
    return "";
  }
}

async function askClaude(msgs) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new UserError("Claude is not set up yet. Add ANTHROPIC_API_KEY on the server.", 503);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: msgs.map((m) => ({
        role: m.role,
        content: [
          ...m.images.map((i) => ({
            type: "image",
            source: { type: "base64", media_type: i.mime, data: i.data },
          })),
          { type: "text", text: m.text },
        ],
      })),
    }),
  });
  if (!r.ok) {
    const detail = await readError(r);
    console.error("Claude error", r.status, detail);
    throw new UserError("Claude could not answer right now (" + r.status + "). Try again, or switch to Gemini.", 502);
  }
  const d = await r.json();
  const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new UserError("Claude sent an empty answer. Please try again.", 502);
  return text;
}

async function askGemini(msgs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new UserError("Gemini is not set up yet. Add GEMINI_API_KEY on the server.", 503);

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) +
    ":generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: msgs.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          ...m.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
          { text: m.text },
        ],
      })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!r.ok) {
    const detail = await readError(r);
    console.error("Gemini error", r.status, detail);
    throw new UserError("Gemini could not answer right now (" + r.status + "). Try again, or switch to Claude.", 502);
  }
  const d = await r.json();
  const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) throw new UserError("Gemini sent an empty answer. Please try again.", 502);
  return text;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") throw new UserError("Use POST.", 405);

    // Optional password so strangers cannot use up your credits.
    const code = process.env.ACCESS_CODE;
    if (code && !sameSecret(req.headers["x-access-code"], code)) {
      throw new UserError("Access code needed.", 401);
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!body || typeof body !== "object") throw new UserError("Bad request.");

    const msgs = cleanMessages(body.messages);
    const reply = body.model === "gemini" ? await askGemini(msgs) : await askClaude(msgs);
    res.status(200).json({ reply });
  } catch (e) {
    if (!(e instanceof UserError)) console.error(e);
    const status = e instanceof UserError ? e.status : 500;
    const message = e instanceof UserError ? e.message : "Something went wrong on the server.";
    res.status(status).json({ error: message });
  }
};
