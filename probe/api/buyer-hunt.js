// Engine 2 — buyer hunting. Active investor buyers are visible in the Property
// Appraiser data itself: corporate entities whose most recent purchase (DOS_1/PRICE_1)
// falls in the lookback window. Repeat purchasers of SCATTERED properties (not one
// condo building) in the flipper price band are the prospects.
// DOS_1 in PaGISView is a STRING in YYYYMMDD form — filter and compare as strings.
// GET ?secret=...&since=YYYY-MM-DD&minPrice=60000&maxAvg=1500000&minCount=2
const SECRET = "lmp_7g2Vq9xKd4RwTz81";
const PAGIS = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/PaGISView_gdb/FeatureServer/0/query";

const CORP_PATTERNS = ["%LLC%", "% INC%", "%CORP%", "%TRUST%", "%INVEST%", "%PROPERTIES%", "%HOLDINGS%", "%CAPITAL%", "%HOMES %"];
const EXCLUDE = ["BANK", "MORTGAGE", "CITY OF", "COUNTY", "MIAMI DADE", "MIAMIDADE", "AUTHORITY", "ASSOCIATION", "ASSN", "CONDO", "CHURCH", "MINIST", "STATE OF", "FLORIDA DEPT", "FEDERAL", "FANNIE", "FREDDIE", "SCHOOL", "HOUSING", "LENNAR", "DR HORTON", "PULTE", "MERITAGE", "US DEPT", "SECRETARY OF", "REIT"];

const normName = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const streetOf = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => !/^\d+$/.test(w) && !/^\d+[A-Z]{1,3}$/.test(w)).join(" ");

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  const { secret, since, minPrice, minCount, maxAvg, top } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const sinceCompact = (/^\d{4}-\d{2}-\d{2}$/.test(since || "") ? since : "2026-01-01").replace(/-/g, "");
  const priceFloor = parseInt(minPrice || "60000", 10);
  const countFloor = parseInt(minCount || "2", 10);
  const avgCap = parseInt(maxAvg || "1500000", 10);
  const topN = Math.min(parseInt(top || "80", 10), 200);

  const corpWhere = "(" + CORP_PATTERNS.map((p) => `TRUE_OWNER1 LIKE '${p}'`).join(" OR ") + ")";
  const where = `DOS_1 >= '${sinceCompact}' AND PRICE_1 >= ${priceFloor} AND ${corpWhere}`;

  try {
    const byOwner = new Map();
    let scanned = 0;
    for (let offset = 0; offset < 12000; offset += 2000) {
      const url = PAGIS + "?where=" + encodeURIComponent(where) +
        "&outFields=TRUE_OWNER1,TRUE_MAILING_ADDR1,TRUE_MAILING_CITY,TRUE_MAILING_STATE,TRUE_MAILING_ZIP_CODE,TRUE_SITE_ADDR,TRUE_SITE_CITY,PRICE_1,DOS_1" +
        "&returnGeometry=false&resultRecordCount=2000&resultOffset=" + offset + "&f=json";
      const j = await getJson(url);
      const feats = j.features || [];
      scanned += feats.length;
      for (const f of feats) {
        const a = f.attributes;
        const owner = normName(a.TRUE_OWNER1);
        if (!owner || EXCLUDE.some((x) => owner.includes(x))) continue;
        let rec = byOwner.get(owner);
        if (!rec) {
          rec = { owner, n: 0, total: 0, lastBuy: "", mailing: "", mailingCity: "", mailingState: "", mailingZip: "", samples: [], streets: new Set() };
          byOwner.set(owner, rec);
        }
        rec.n += 1;
        rec.total += a.PRICE_1 || 0;
        rec.streets.add(streetOf(a.TRUE_SITE_ADDR));
        const d = String(a.DOS_1 || "");
        if (d > rec.lastBuy) {
          rec.lastBuy = d;
          rec.mailing = a.TRUE_MAILING_ADDR1 || rec.mailing;
          rec.mailingCity = a.TRUE_MAILING_CITY || rec.mailingCity;
          rec.mailingState = a.TRUE_MAILING_STATE || rec.mailingState;
          rec.mailingZip = String(a.TRUE_MAILING_ZIP_CODE || "").slice(0, 5) || rec.mailingZip;
        }
        if (rec.samples.length < 3) rec.samples.push((a.TRUE_SITE_ADDR || "") + (a.TRUE_SITE_CITY ? ", " + a.TRUE_SITE_CITY : ""));
      }
      if (feats.length < 2000) break;
    }

    const prospects = [...byOwner.values()]
      .filter((r) => {
        const avg = r.total / r.n;
        const dispersed = r.streets.size >= Math.min(3, r.n);
        return r.n >= countFloor && dispersed && avg >= priceFloor && avg <= avgCap;
      })
      .sort((x, y) => y.n - x.n || y.total - x.total)
      .slice(0, topN)
      .map((r) => ({
        owner: r.owner, n: r.n, total: Math.round(r.total), avg: Math.round(r.total / r.n),
        streets: r.streets.size,
        lastBuy: r.lastBuy ? `${r.lastBuy.slice(0, 4)}-${r.lastBuy.slice(4, 6)}-${r.lastBuy.slice(6, 8)}` : "",
        mailing: r.mailing, mailingCity: r.mailingCity, mailingState: r.mailingState, mailingZip: r.mailingZip,
        samples: r.samples
      }));

    res.status(200).json({ county: "Miami-Dade", since: sinceCompact, scanned, unique_corporate_owners: byOwner.size, prospects_returned: prospects.length, prospects });
  } catch (e) {
    res.status(200).json({ error: String(e) });
  }
};
