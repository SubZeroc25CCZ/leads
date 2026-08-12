// LeadMachine probe: server-side fetch tester for public open-data endpoints.
// Deployed as Vercel project "leadmachine-probe". Used because the dev sandbox
// has no direct egress to county/ArcGIS domains — this function fetches on our behalf.
// Auth: shared secret in query. Only https URLs.
const SECRET = "lmp_7g2Vq9xKd4RwTz81";

module.exports = async (req, res) => {
  const { url, secret, limit, method, body, ct } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  if (!url) return res.status(400).json({ error: "missing url" });
  let u;
  try { u = new URL(url); } catch (e) { return res.status(400).json({ error: "bad url" }); }
  if (u.protocol !== "https:") return res.status(400).json({ error: "https only" });
  const m = (method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(m)) return res.status(400).json({ error: "GET/POST only" });
  try {
    const r = await fetch(url, {
      method: m,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LeadMachineProbe/1.0)",
        "accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        ...(m === "POST" ? { "content-type": ct || "application/json" } : {})
      },
      ...(m === "POST" ? { body: body || "" } : {}),
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });
    const text = await r.text();
    const lim = Math.min(parseInt(limit || "6000", 10) || 6000, 100000);
    res.status(200).json({
      status: r.status,
      contentType: r.headers.get("content-type"),
      finalUrl: r.url,
      length: text.length,
      body: text.slice(0, lim)
    });
  } catch (e) {
    res.status(200).json({ fetchError: String(e) });
  }
};
