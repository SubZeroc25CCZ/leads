const DB_ID = process.env.CF_D1_DATABASE_ID || "bce5b2af-1852-4aa0-a084-ecba3d3f3933";
const ACCOUNT = process.env.CF_ACCOUNT_ID || "3472fe0b25f5c0f49a99d537cbe2cf35";
async function d1(sql, params) {
  if (!process.env.CF_API_TOKEN) throw new Error("D1 credentials not configured");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) });
  const body = await r.json(); if (!r.ok || body.success === false) throw new Error("D1 query failed"); return body.result;
}
function isBot(req) {
  const asn = String(req.headers["x-vercel-ip-asn"] || req.headers["x-forwarded-for-asn"] || "");
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  return /^(13335|16509|14618|8075|15169|14061|63949)$/.test(asn) || /bot|crawler|spider|headless|curl|wget|python-requests/.test(ua);
}
export default async function handler(req, res) {
  const token = String(req.query?.token || "").trim();
  if (!token || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) return res.status(404).send("Not found");
  try {
    const r = await d1("SELECT destination_url FROM offer_tokens WHERE token = ? LIMIT 1", [token]);
    const destination = r.results?.[0]?.destination_url;
    if (!destination || !/^https?:\/\//i.test(destination)) return res.status(404).send("Not found");
    const ua = String(req.headers["user-agent"] || "").slice(0, 500);
    await d1("INSERT INTO offer_clicks (token,clicked_at,country,user_agent,is_bot) VALUES (?,?,?,?,?)", [token, new Date().toISOString(), String(req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"] || "").slice(0, 8), ua, isBot(req) ? 1 : 0]);
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Location", destination); return res.status(302).end();
  } catch (e) { console.error("[offer redirect]", e); return res.status(404).send("Not found"); }
}
