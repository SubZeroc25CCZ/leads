const DB_ID = process.env.CF_D1_DATABASE_ID || "bce5b2af-1852-4aa0-a084-ecba3d3f3933";
const ACCOUNT = process.env.CF_ACCOUNT_ID || "3472fe0b25f5c0f49a99d537cbe2cf35";
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);

async function d1(sql, params) {
  if (!process.env.CF_API_TOKEN) return;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) });
  if (!response.ok) throw new Error("D1 error");
}

async function telegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const company = clean(body.company, 150), email = clean(body.email, 254).toLowerCase();
  const need = clean(body.need, 30), skipTracing = clean(body.skip_tracing, 30);
  if (!company || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Enter a company and valid work email." });
  try {
    const notes = `MCA inquiry · need=${need} · skip_tracing=${skipTracing}`;
    await d1(`INSERT INTO buyer_leads (email,counties,volume,source,status,notes,created_at,updated_at) VALUES (?,?,?,?, 'mca_inquiry', ?,datetime('now'),datetime('now')) ON CONFLICT(email) DO UPDATE SET source='mca',status='mca_inquiry',notes=excluded.notes,updated_at=datetime('now')`, [email, "Colorado MCA", need, "mca", notes]);
    await telegram(`LeadMachine MCA inquiry\n\nCompany: ${company}\nEmail: ${email}\nNeed: ${need}\nSkip-tracing: ${skipTracing}`);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[api/mca]", error);
    return res.status(502).json({ error: "Could not save the request. Email leadmachine@agentmail.to directly." });
  }
}
