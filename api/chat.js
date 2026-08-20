const STOCK_URL = "https://leadmachine-gamma.vercel.app/api/portal?action=stock";
const DB_ID = process.env.CF_D1_DATABASE_ID || "bce5b2af-1852-4aa0-a084-ecba3d3f3933";
const DB_ACCOUNT = process.env.CF_ACCOUNT_ID || "3472fe0b25f5c0f49a99d537cbe2cf35";

const clean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

async function d1(sql, params = []) {
  if (!process.env.CF_API_TOKEN) throw new Error("D1 credentials not configured");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${DB_ACCOUNT}/d1/database/${DB_ID}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await r.json();
  if (!r.ok || body.success === false) throw new Error("D1 write failed");
  return body.result;
}

async function stock() {
  const r = await fetch(STOCK_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("stock unavailable");
  return r.json();
}

function isBot(req) {
  const asn = clean(req.headers["x-vercel-ip-asn"] || req.headers["x-forwarded-for-asn"]);
  const ua = clean(req.headers["user-agent"], 300).toLowerCase();
  return Boolean(asn && /^(13335|16509|14618|8075|15169|14061|63949)$/.test(asn)) || /bot|crawler|spider|headless|curl|wget|python-requests/.test(ua);
}

function stockLine(s, query) {
  const q = clean(query).toLowerCase();
  const hit = (s.counties || []).find((c) => c.county.toLowerCase() === q || c.county.toLowerCase().includes(q));
  if (!hit) return q ? `We are live in ${((s.counties || []).map((c) => c.county)).join(", ")}. We are not in ${clean(query)} yet, but I can capture the demand and notify Asaf.` : `We are live in ${(s.counties || []).map((c) => `${c.county}: ${c.total} sellable`).join(" · ")}.`;
  return `${hit.county}: ${hit.single} single-signal and ${hit.cross} cross-verified leads on the shelf right now. That is live inventory, not a promise of future stock.`;
}

function faqText(s) {
  return `LeadMachine sells public-record distress data only. Live counties and stock: ${(s.counties || []).map((c) => `${c.county} (${c.total})`).join(", ")}. A lead includes address, county, case reference, case age, owner name where matched, mailing state, signals and score. Owner data is verified against Florida Property Appraiser tax rolls where available. We offer a free sample and do not contact property owners. We do not invent future counties or volume.`;
}

async function sendSample(email, counties, volume) {
  // LM_API_KEY is the credential accepted by the existing harvester/export API.
  // CHAT_ADMIN_API_KEY remains available for a future dedicated chat credential,
  // but never masks the verified integration key during the transition.
  const adminKey = process.env.LM_API_KEY || process.env.CHAT_ADMIN_API_KEY;
  if (!adminKey || !process.env.AGENTMAIL_API_KEY) throw new Error("sample delivery is not configured");
  const url = new URL("https://leadmachine-gamma.vercel.app/api/export");
  url.searchParams.set("limit", "10");
  if (counties) url.searchParams.set("county", counties.split(",")[0].trim());
  const csvRes = await fetch(url, { headers: { "x-api-key": adminKey } });
  if (!csvRes.ok) throw new Error("sample export failed");
  const csv = await csvRes.text();
  const mail = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(process.env.AGENTMAIL_INBOX || "leadmachine@agentmail.to")}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: [email],
      subject: "Your LeadMachine sample is ready",
      text: `Attached are 10 live LeadMachine records for ${counties || "Florida"}. We used your request for ${volume || "a starter batch"}. Reply if you want a county-specific shelf.`,
      attachments: [{ content: Buffer.from(csv, "utf8").toString("base64"), filename: "leadmachine-sample.csv", content_type: "text/csv" }],
    }),
  });
  if (!mail.ok) throw new Error("sample email failed");
}

async function notifyTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) }).catch(() => {});
}

async function llmReply(message, s) {
  if (!process.env.ANTHROPIC_API_KEY) return { answer: faqText(s), confidence: 0.5 };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest", max_tokens: 240, system: `Answer only from this grounding pack. Never invent inventory, counties, fields, pricing or delivery promises. If the question is not answerable, say ESCALATE. Grounding: ${faqText(s)} Live JSON: ${JSON.stringify(s)}`, messages: [{ role: "user", content: clean(message, 1000) }] }),
  });
  if (!r.ok) return { answer: "I’m leaving that for Asaf — you’ll hear back today.", confidence: 0 };
  const body = await r.json();
  const answer = body.content?.map((x) => x.text || "").join("").trim() || "I’m leaving that for Asaf — you’ll hear back today.";
  return { answer, confidence: /ESCALATE|you.?ll hear back/i.test(answer) ? 0.2 : 0.9 };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    const s = await stock();
    const bot = isBot(req);
    const op = clean(body.op || "message", 30);
    if (op === "message") {
      const step = clean(body.step || "county", 30);
      const message = clean(body.message, 1000);
      if (bot) return res.json({ ok: true, bot: true, step, answer: faqText(s), stock: s });
      if (step === "county") return res.json({ ok: true, step: "volume", answer: `${stockLine(s, message)} How many leads do you want to start with?`, stock: s });
      if (step === "volume") return res.json({ ok: true, step: "email", answer: "Good. What work email should receive the 10-record sample?", stock: s });
      if (step === "email") return res.json({ ok: true, step: "confirm", answer: validEmail(message) ? "I have it. Send the sample now? Reply yes to send it." : "That email does not look complete yet. Please try again.", valid: validEmail(message), stock: s });
      if (step === "confirm" && /^y(es)?$/i.test(message)) return res.json({ ok: true, step: "submitted", answer: "Send me the email, county and volume in one message and I’ll deliver the sample.", stock: s });
      const reply = await llmReply(message, s);
      if (reply.confidence < 0.6) await notifyTelegram(`LeadMachine chat escalation\nQuestion: ${message}\nDraft: ${reply.answer}`);
      return res.json({ ok: true, step, answer: reply.answer, escalated: reply.confidence < 0.6, stock: s });
    }
    if (op === "submit") {
      const email = clean(body.email, 254).toLowerCase();
      const counties = clean(body.counties, 300);
      const volume = clean(body.volume, 60);
      if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
      await d1(`INSERT INTO buyer_leads (email,counties,volume,source,status,created_at,updated_at) VALUES (?,?,?,?, 'new',datetime('now'),datetime('now')) ON CONFLICT(email) DO UPDATE SET counties=excluded.counties, volume=excluded.volume, source='chat', requests=requests+1, updated_at=datetime('now')`, [email, counties, volume, "chat"]);
      await sendSample(email, counties, volume);
      await d1(`UPDATE buyer_leads SET status='sampled', sample_sent_at=datetime('now'), notes=? WHERE email=?`, [`chat sample delivered for ${counties || "all live counties"}`, email]);
      return res.json({ ok: true, step: "sent", answer: "Your sample is in your inbox. It contains live records from the shelf we just checked.", stock: s });
    }
    return res.status(400).json({ error: "Unknown chat operation" });
  } catch (err) {
    console.error("[chat]", err);
    return res.status(502).json({ error: "I could not complete that request right now. Please leave your email and Asaf will follow up." });
  }
}
