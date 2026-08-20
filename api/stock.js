const STOCK_URL = "https://leadmachine-gamma.vercel.app/api/portal?action=stock";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const upstream = await fetch(STOCK_URL, { headers: { "Accept": "application/json" }, cache: "no-store" });
    const body = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(upstream.status).json(body);
  } catch (err) {
    return res.status(502).json({ ok: false, error: "Live inventory is temporarily unavailable." });
  }
}

export { STOCK_URL };

// The chat endpoint is kept in a separate function file so it can be deployed
// independently without affecting the static homepage. See api/chat.js.
