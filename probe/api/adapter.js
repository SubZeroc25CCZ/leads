// Socrata -> ArcGIS response adapter. The deployed harvester parses ArcGIS
// {features:[{attributes:{...}}]} responses; this endpoint lets Socrata-backed
// sources (e.g. Orlando code enforcement) plug into the same sources table:
//   url_template: https://leadmachine-probe.vercel.app/api/adapter?src=orlando_code&cutoff={cutoff_date}&secret=...
// Each config maps a Socrata dataset to clean ArcGIS-shaped attributes.
const SECRET = "lmp_7g2Vq9xKd4RwTz81";

const CONFIGS = {
  orlando_code: {
    // City of Orlando code enforcement cases (Orange County), fresh daily.
    url: (cutoff) =>
      "https://data.cityoforlando.net/resource/k6e8-nw6w.json" +
      "?$select=apno,casedt,casename,derived_address,caseinfostatus,casetype" +
      "&$where=" + encodeURIComponent(`casedt >= '${cutoff}T00:00:00' AND derived_address NOT LIKE '%No Address%'`) +
      "&$order=casedt DESC&$limit=500",
    map: (r) => ({
      CASE_NUM: r.apno || "",
      CASE_DATE: r.casedt || "",
      CASE_STATUS: r.caseinfostatus || "",
      // derived_address looks like "1611 E JEFFERSON ST  ORLANDO FL" -> strip trailing city/state
      ADDRESS: String(r.derived_address || "").replace(/\s+ORLANDO FL\s*$/i, "").replace(/\s{2,}/g, " ").trim(),
      CITY: "Orlando"
    }),
    valid: (attrs) => attrs.ADDRESS.length > 5
  }
};

module.exports = async (req, res) => {
  const { secret, src, cutoff } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const cfg = CONFIGS[src];
  if (!cfg) return res.status(400).json({ error: "unknown src" });
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoff || "") ? cutoff : "2026-07-13";
  try {
    const r = await fetch(cfg.url(cutoffDate), { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error("upstream HTTP " + r.status);
    const data = await r.json();
    const features = [];
    for (const row of Array.isArray(data) ? data : []) {
      const attrs = cfg.map(row);
      if (cfg.valid(attrs)) features.push({ attributes: attrs });
    }
    res.status(200).json({ features });
  } catch (e) {
    res.status(200).json({ features: [], error: String(e) });
  }
};
