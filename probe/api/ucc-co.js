// LeadMachine: CO UCC -> MCA/fintech-debt merchant list.
// Joins Socrata ap62-sav4 (secured parties) -> 8upq-58vz (org debtors) -> wffy-3uut (filing dates)
// server-side, applies the managed lender allow/deny lists, and returns final CSV.
const SECRET = "lmp_7g2Vq9xKd4RwTz81";
const BASE = "https://data.colorado.gov/resource";

const NAMED = ["LCF GROUP","CREDIBLY","LILY ADVANCE","BITTY","GIGGLE","F.B.F","CFG MERCHANT",
  "STAR CAPITAL GROUP","CROMWELL CAPITAL","FUNDING METRICS","LENDISTRY","FIRST DATA MERCHANT",
  "ARF FINANCIAL","FORWARD FINANCING","FUNDBOX","KAPITUS","ONDECK","RAPID FINANCE","CAN CAPITAL",
  "EXPANSION CAPITAL","PEARL CAPITAL","EBF HOLDINGS","VADER SERVICING","CLOUDFUND","SAMSON",
  "UNIQUE FUNDING","WEBBANK"];
const GENERIC = ["ADVANCE","MERCHANT"];
const EXCLUDE = ["BANK","CREDIT UNION","N.A.","JOHN DEERE","PACCAR","CNH","WELLS FARGO","US SBA","SBA",
  "SMALL BUSINESS ADMINISTRATION","B:SIDE","FARM","LEAF CAPITAL","VERDANT","MITSUBISHI","HC CAPITAL",
  "EQUIPMENT","LEASING","DE LAGE","ASCENTIUM","BALBOA","NAVITAS","AMUR","STEARNS","CIT GROUP",
  "HUNTINGTON","FIRST-CITIZENS","TCF","ALLIANCE FUNDING GROUP","NORTHLAND","CUSTOM TRUCK","AUXILIOR",
  "EAGLE CAPITAL","FACTORING"];
const DEAD = ["DISSOLVED","INACTIVE","DBA CANCELLED"];
const SUFFIX = /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LLLP|LLP|LP|PLLC|PC|P\.C|CO|COMPANY|DBA)\b/g;

const isMca = (sp) => {
  const u = (sp || "").toUpperCase();
  if (!u) return false;
  if (EXCLUDE.some((x) => u.includes(x))) return false;
  return NAMED.some((n) => u.includes(n)) || GENERIC.some((g) => u.includes(g));
};
const norm = (n) => n.toUpperCase().replace(/\s*-\s*\d+\s*$/, "").replace(/[^A-Z0-9 ]/g, " ")
  .replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

async function soda(path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}/${path}?${qs}`, {
    headers: { "user-agent": "LeadMachineProbe/1.0", accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function pageAll(path, params, cap) {
  const out = [];
  for (let off = 0; off < cap; off += 1000) {
    const rows = await soda(path, { ...params, $limit: 1000, $offset: off });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

module.exports = async (req, res) => {
  const { secret, minfileid, format } = req.query || {};
  if (secret !== SECRET) return res.status(401).json({ error: "unauthorized" });
  const lo = minfileid || "2389449";
  try {
    const spWhere =
      `fileid >= '${lo}' AND recordstatuscd='A' AND (` +
      [...GENERIC, ...NAMED].map((k) => `upper(organizationname) like '%${k}%'`).join(" OR ") + `)`;
    const sps = await pageAll("ap62-sav4.json", { $select: "fileid,organizationname", $where: spWhere }, 20000);

    const spByFile = new Map();
    for (const s of sps) {
      if (!spByFile.has(s.fileid)) spByFile.set(s.fileid, new Set());
      spByFile.get(s.fileid).add((s.organizationname || "").trim());
    }
    const ids = [...spByFile.keys()];

    const debtors = [], filings = new Map();
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300).map((x) => `'${x}'`).join(",");
      const [d, f] = await Promise.all([
        soda("8upq-58vz.json", {
          $select: "fileid,organizationname,address1,city,state,zipcode",
          $where: `fileid in (${chunk}) AND organizationname IS NOT NULL AND recordstatuscode='A'`,
          $limit: 5000,
        }),
        soda("wffy-3uut.json", {
          $select: "fileid,filingdate,lapsedate",
          $where: `fileid in (${chunk}) AND transactiontype='Initial Filing' AND filingtype='ucc'`,
          $limit: 5000,
        }),
      ]);
      debtors.push(...d);
      for (const x of f) filings.set(x.fileid, x);
    }

    const best = new Map();
    let dead = 0, nofiling = 0;
    for (const d of debtors) {
      const f = filings.get(d.fileid);
      if (!f) { nofiling += 1; continue; }
      const name = (d.organizationname || "").trim();
      if (DEAD.some((x) => name.toUpperCase().includes(x))) { dead += 1; continue; }
      const sp = [...(spByFile.get(d.fileid) || [])].sort().join(" | ");
      if (!isMca(sp)) continue;
      const row = {
        business_name: name,
        address: (d.address1 || "").trim(),
        city: (d.city || "").trim(),
        state: (d.state || "").trim(),
        zip: (d.zipcode || "").trim().slice(0, 10),
        filing_date: (f.filingdate || "").slice(0, 10),
        lapse_date: (f.lapsedate || "").slice(0, 10),
        secured_party: sp,
        source_state: "CO",
      };
      const k = `${norm(name)}|${row.zip}`;
      const prev = best.get(k);
      if (!prev || row.filing_date > prev.filing_date) best.set(k, row);
    }

    const rows = [...best.values()].sort((a, b) => (a.filing_date < b.filing_date ? 1 : -1));
    const stats = { sp_rows: sps.length, fileids: ids.length, debtor_rows: debtors.length,
                    dead_removed: dead, no_initial_filing: nofiling, final_rows: rows.length };
    if (format === "csv") {
      const cols = Object.keys(rows[0] || { business_name: 1 });
      const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
      res.setHeader("content-type", "text/csv");
      return res.status(200).send(
        [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n")
      );
    }
    res.status(200).json({ stats, rows });
  } catch (e) {
    res.status(200).json({ error: String(e) });
  }
};
