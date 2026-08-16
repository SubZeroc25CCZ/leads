// Harvest fetch+normalize, stateless. Replaces the un-versioned half of the
// deployed harvester: given a source's query URL and field map, returns clean
// lead rows ready for a dedup-upsert into D1 (which the ops session performs —
// this function holds no credentials).
//   GET ?secret=...&county=Lee&url=<encoded ArcGIS/adapter query URL>
//       &map=<encoded JSON {"address":"FLD","owner":"FLD","city":"FLD","zip":"FLD"}>
// Returns {fetched, skipped, rows:[{address,address_key,owner,city,zip}]}
const SECRET = "lmp_7g2Vq9xKd4RwTz81";

const keyOf = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Deerfield's USER_Site_Address repeats the unit designator after the ZIP
// ("... DEERFIELD BEACH, FL 33064 B7", "... FL 33442 #227"). Nothing meaningful
// follows a ZIP in a US address, so anything trailing it is dropped — otherwise
// the same property yields two address_keys and dedup misses it.
// Placeholders the county systems put in the address field when they have none.
// Miami-Dade uses "NOT AVAILABLE" alongside the two we already knew about, and one
// such row reached D1 as a lead before this was caught (16.08).
const PLACEHOLDERS = new Set(["NO ADDRESS", "NOT AVAILABLE", "EXEMPT FROM PUBLIC RECORDS"]);
const stripAfterZip = (s) => s.replace(/(\bFL\s+\d{5})\b.*$/i, "$1");
const cleanAddr = (s) => stripAfterZip(String(s || "").replace(/\s+/g, " ").trim()).trim();

module.exports = async (req, res) => {
  const { secret, url, map, county } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  if (!url) return res.status(400).json({ error: "missing url" });
  let u, fieldMap;
  try { u = new URL(url); } catch (e) { return res.status(400).json({ error: "bad url" }); }
  if (u.protocol !== "https:") return res.status(400).json({ error: "https only" });
  try { fieldMap = JSON.parse(map || "{}"); } catch (e) { return res.status(400).json({ error: "bad map json" }); }
  if (!fieldMap.address) return res.status(400).json({ error: "map.address required" });

  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; LeadMachineProbe/1.0)", accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) throw new Error("upstream HTTP " + r.status);
    const j = await r.json();
    const feats = j.features || [];

    const seen = new Set();
    const rows = [];
    let skipped = 0;
    for (const f of feats) {
      const a = f.attributes || {};
      const address = cleanAddr(a[fieldMap.address]);
      const address_key = keyOf(address);
      if (
        !address || address_key.length < 4 ||
        PLACEHOLDERS.has(address.toUpperCase()) ||
        address.includes(" - ") || seen.has(address_key)
      ) { skipped += 1; continue; }
      seen.add(address_key);
      rows.push({
        address,
        address_key,
        owner: cleanAddr(fieldMap.owner ? a[fieldMap.owner] : ""),
        city: cleanAddr(fieldMap.city ? a[fieldMap.city] : ""),
        zip: String((fieldMap.zip ? a[fieldMap.zip] : "") || "").slice(0, 5)
      });
    }

    res.status(200).json({ county: county || "", fetched: feats.length, skipped, rows });
  } catch (e) {
    res.status(200).json({ error: String(e), fetched: 0, skipped: 0, rows: [] });
  }
};
