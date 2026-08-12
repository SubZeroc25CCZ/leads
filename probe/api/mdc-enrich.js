// Miami-Dade enrichment: given lead address_keys (normalized), find their FOLIOs via the
// code-violations layer, then pull owner / city / zip / mailing from the Property Appraiser
// layer (PaGISView) and flag absentee owners (mailing address != site address).
// Runs on Vercel because the dev sandbox has no egress to *.arcgis.com.
const SECRET = "lmp_7g2Vq9xKd4RwTz81";

const CCVIOL = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/CCVIOL_gdb/FeatureServer/0/query";
const PAGIS = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaGISView_gdb/FeatureServer/0/query";

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " for " + url.slice(0, 120));
  return r.json();
}

module.exports = async (req, res) => {
  const { secret, keys, cutoff } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const wanted = new Set(String(keys || "").split(",").map((k) => k.trim()).filter(Boolean));
  if (!wanted.size) return res.status(400).json({ error: "missing keys" });
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoff || "") ? cutoff : "2026-07-01";

  try {
    // 1. violations since cutoff -> address_key -> folio (13-digit, layer pads to 15)
    const keyToFolio = new Map();
    for (let offset = 0; offset < 6000; offset += 1000) {
      const url = CCVIOL + "?where=" + encodeURIComponent(`CASE_DATE >= DATE '${cutoffDate}'`) +
        "&outFields=ADDRESS,FOLIO&returnGeometry=false&resultRecordCount=1000&resultOffset=" + offset + "&f=json";
      const j = await getJson(url);
      const feats = j.features || [];
      for (const f of feats) {
        const k = norm(f.attributes.ADDRESS);
        const folio = String(f.attributes.FOLIO || "").trim();
        if (k && folio.length === 13 && !keyToFolio.has(k)) keyToFolio.set(k, folio);
      }
      if (feats.length < 1000) break;
    }

    const matches = [];
    for (const k of wanted) if (keyToFolio.has(k)) matches.push({ k, folio: keyToFolio.get(k) });

    // 2. Property Appraiser batches by folio
    const rows = [];
    for (let i = 0; i < matches.length; i += 80) {
      const batch = matches.slice(i, i + 80);
      const inList = batch.map((m) => `'${m.folio}'`).join(",");
      const url = PAGIS + "?where=" + encodeURIComponent(`FOLIO IN (${inList})`) +
        "&outFields=FOLIO,TRUE_OWNER1,TRUE_OWNER2,TRUE_SITE_ADDR,TRUE_SITE_CITY,TRUE_SITE_ZIP_CODE,TRUE_MAILING_ADDR1,TRUE_MAILING_CITY,TRUE_MAILING_STATE,TRUE_MAILING_ZIP_CODE&returnGeometry=false&f=json";
      const j = await getJson(url);
      const byFolio = new Map((j.features || []).map((f) => [String(f.attributes.FOLIO).trim(), f.attributes]));
      for (const m of batch) {
        const a = byFolio.get(m.folio);
        if (!a) continue;
        const owner = [a.TRUE_OWNER1, a.TRUE_OWNER2].filter(Boolean).join(" & ").trim();
        const mailing = [a.TRUE_MAILING_ADDR1, a.TRUE_MAILING_CITY, a.TRUE_MAILING_STATE].filter(Boolean).join(", ");
        const absentee = !!a.TRUE_MAILING_ADDR1 &&
          (norm(a.TRUE_MAILING_ADDR1) !== norm(a.TRUE_SITE_ADDR) || (a.TRUE_MAILING_STATE || "FL").toUpperCase().trim() !== "FL");
        rows.push({
          k: m.k,
          folio: m.folio,
          owner,
          city: a.TRUE_SITE_CITY || "",
          zip: String(a.TRUE_SITE_ZIP_CODE || "").slice(0, 5),
          mailing,
          absentee
        });
      }
    }

    res.status(200).json({ requested: wanted.size, folio_matched: matches.length, enriched: rows.length, rows });
  } catch (e) {
    res.status(200).json({ error: String(e) });
  }
};
