const DB_ID = process.env.CF_D1_DATABASE_ID || "bce5b2af-1852-4aa0-a084-ecba3d3f3933";
const ACCOUNT = process.env.CF_ACCOUNT_ID || "3472fe0b25f5c0f49a99d537cbe2cf35";
const clean = (v, n = 500) => String(v == null ? "" : v).trim().slice(0, n);
async function d1(sql, params) {
  if (!process.env.CF_API_TOKEN) return;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) });
  if (!r.ok) throw new Error("D1 error");
}
async function telegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) });
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const company = clean(b.company, 150), counties = clean(b.counties, 300), volume = clean(b.volume, 100), crm = clean(b.crm, 10), email = clean(b.email, 254).toLowerCase();
  if (!company || !counties || !volume || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Complete every field with a valid work email." });
  try {
    const notes = `enterprise pilot · company=${company} · counties=${counties} · weekly=${volume} · CRM=${crm}`;
    await d1(`INSERT INTO buyer_leads (email,counties,volume,source,status,notes,created_at,updated_at) VALUES (?,?,?,?, 'enterprise', ?,datetime('now'),datetime('now')) ON CONFLICT(email) DO UPDATE SET counties=excluded.counties,volume=excluded.volume,source='enterprise',status='enterprise',notes=excluded.notes,updated_at=datetime('now')`, [email, counties, volume, "partners", notes]);
    await telegram(`LeadMachine enterprise pilot\n\nCompany: ${company}\nEmail: ${email}\nCounties: ${counties}\nWeekly volume: ${volume}\nCRM: ${crm}\n\nDraft: Thanks — we can scope a 30-day pilot around those counties and volume. I’ll confirm delivery shape and terms shortly.`);
    return res.json({ ok: true });
  } catch (e) { console.error("[partners]", e); return res.status(502).json({ error: "Could not save the pilot request." }); }
}
