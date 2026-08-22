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

const DEAD = ["DISSOLVED","INACTIVE","DBA CANCELLED","DELINQUENT","NOT IN GOOD STANDING","ADMIN DISSOLVED"];
const SUFFIX = /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LLLP|LLP|LP|PLLC|PC|P\.C|CO|COMPANY|DBA|TRUST|FOUNDATION|PARTNERS|GROUP|ENTERPRISES|HOLDINGS|SERVICES|SOLUTIONS)\b/;
const SUFFIX_G = new RegExp(SUFFIX.source, "g");

const isMca = (sp) => {
  const u = (sp || "").toUpperCase();
  if (!u) return false;
  if (EXCLUDE.some((x) => u.includes(x))) return false;
  return NAMED.some((n) => u.includes(n)) || GENERIC.some((g) => u.includes(g));
};
const isDead = (n) => DEAD.some((x) => n.toUpperCase().includes(x));
const isFkaShell = (n) => /^\s*F\/?K\/?A[\s:.,]/i.test(n);
// Person-shaped: no entity suffix anywhere and a 2-3 token capitalized-name shape.
const isPersonShaped = (n) => {
  const u = n.toUpperCase();
  if (SUFFIX.test(u)) return false;
  const toks = u.replace(/[^A-Z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return toks.length >= 2 && toks.length <= 3 && toks.every((t) => /^[A-Z]+$/.test(t) && t.length >= 2);
};
const norm = (n) => n.toUpperCase()
  .replace(/\s*-\s*\d+\s*$/, "")
  .replace(/['\u2018\u2019\u0060]S\b/g, "")      // trailing 's / `s
  .replace(/[^A-Z0-9 ]/g, " ")
  .replace(SUFFIX_G, " ")
  .replace(/\s+/g, " ").trim();

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
  const { secret, minfileid, format, state } = req.query || {};
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

    const debtorsByFile = new Map();
    const filings = new Map();
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
      for (const x of d) {
        if (!debtorsByFile.has(x.fileid)) debtorsByFile.set(x.fileid, []);
        debtorsByFile.get(x.fileid).push(x);
      }
      for (const x of f) filings.set(x.fileid, x);
    }

    // Pass 1 — one row per FILING: primary org debtor + aka list.
    const filingRows = [];
    let dead = 0, nofiling = 0, personOnly = 0, offstate = 0;
    for (const [fileid, debtors] of debtorsByFile) {
      const f = filings.get(fileid);
      if (!f) { nofiling += 1; continue; }
      const sp = [...(spByFile.get(fileid) || [])].sort().join(" | ");
      if (!isMca(sp)) continue;

      const names = debtors.map((d) => ({ ...d, name: (d.organizationname || "").trim() }))
        .filter((d) => d.name && !isFkaShell(d.name));
      if (names.some((d) => isDead(d.name))) { dead += 1; continue; }
      const businesses = names.filter((d) => !isPersonShaped(d.name));
      if (!businesses.length) { personOnly += 1; continue; }

      // Prefer an entity-suffixed name as the face of the row.
      businesses.sort((a, b) =>
        (SUFFIX.test(b.name.toUpperCase()) ? 1 : 0) - (SUFFIX.test(a.name.toUpperCase()) ? 1 : 0) ||
        a.name.length - b.name.length);
      const primary = businesses[0];
      const st = (primary.state || "").trim().toUpperCase();
      if (state && st !== state.toUpperCase()) { offstate += 1; continue; }
      const akaSet = new Set();
      for (const d of names) if (norm(d.name) !== norm(primary.name)) akaSet.add(d.name);

      filingRows.push({
        fileid,
        business_name: primary.name,
        aka: [...akaSet].join(" | "),
        address: (primary.address1 || "").trim(),
        city: (primary.city || "").trim(),
        state: st,
        zip: (primary.zipcode || "").trim().slice(0, 10),
        filing_date: (f.filingdate || "").slice(0, 10),
        lapse_date: (f.lapsedate || "").slice(0, 10),
        secured_party: sp,
      });
    }

    // Pass 2 — merchant-level dedupe ACROSS filings, statewide fuzzy key.
    const best = new Map();
    for (const r of filingRows) {
      const k = norm(r.business_name);
      const prev = best.get(k);
      if (!prev) { best.set(k, { ...r, mca_filings_count: 1 }); continue; }
      prev.mca_filings_count += 1;
      if (r.filing_date > prev.filing_date) {
        const count = prev.mca_filings_count;
        const mergedAka = new Set([...(prev.aka ? prev.aka.split(" | ") : []), ...(r.aka ? r.aka.split(" | ") : [])]);
        best.set(k, { ...r, aka: [...mergedAka].join(" | "), mca_filings_count: count });
      } else if (r.aka) {
        for (const a of r.aka.split(" | ")) if (a) prev.aka = prev.aka ? (prev.aka.includes(a) ? prev.aka : prev.aka + " | " + a) : a;
      }
    }

    const rows = [...best.values()].sort((a, b) => (a.filing_date < b.filing_date ? 1 : -1))
      .map(({ fileid, ...r }) => ({ ...r, source_state: "CO" }));
    const stats = { sp_rows: sps.length, fileids: ids.length,
                    filings_kept: filingRows.length, dead_removed: dead, person_only_removed: personOnly,
                    off_state_removed: offstate, no_initial_filing: nofiling, unique_businesses: rows.length };
    if (format === "csv") {
      const cols = ["business_name","aka","address","city","state","zip","filing_date","lapse_date","secured_party","mca_filings_count","source_state"];
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const lines = [cols.join(",")];
      for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
      res.setHeader("content-type", "text/csv");
      return res.status(200).send(lines.join("\n"));
    }
    res.status(200).json({ stats, rows });
  } catch (e) {
    res.status(200).json({ error: String(e) });
  }
};
