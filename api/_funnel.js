// Shared funnel logic for every buyer entry point on the landing page.
//
// Both the #claim form (api/lead.js) and the concierge (api/chat.js) must
// behave identically: same bot filter, same coverage honesty, same sample
// delivery, same email_log provenance. Divergence here is what produced the
// dead-form and "notify <name>" bugs, so the behaviour lives in one place.
//
// House voice rule: the brand speaks as "we". No personal name ever appears in
// buyer-facing copy, in email bodies, or in escalation text.

const STOCK_URL = "https://leadmachine-gamma.vercel.app/api/portal?action=stock";
const DB_ID = process.env.CF_D1_DATABASE_ID || "bce5b2af-1852-4aa0-a084-ecba3d3f3933";
const DB_ACCOUNT = process.env.CF_ACCOUNT_ID || "3472fe0b25f5c0f49a99d537cbe2cf35";
const INBOX = process.env.AGENTMAIL_INBOX || "leadmachine@agentmail.to";

const clean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ""));

async function d1(sql, params = []) {
  if (!process.env.CF_API_TOKEN) throw new Error("D1 credentials not configured");
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${DB_ACCOUNT}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    }
  );
  const body = await r.json();
  if (!r.ok || body.success === false) {
    const detail = (body.errors && body.errors[0] && body.errors[0].message) || r.status;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return Array.isArray(body.result) ? body.result[0] : body.result;
}

async function stock() {
  const r = await fetch(STOCK_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("stock unavailable");
  return r.json();
}

// Datacenter ASNs plus obvious automation user agents. Bots get static copy and
// never reach the LLM, so crawler traffic cannot spend tokens.
function isBot(req) {
  const h = (req && req.headers) || {};
  const asn = clean(h["x-vercel-ip-asn"] || h["x-forwarded-for-asn"], 20);
  const ua = clean(h["user-agent"], 300).toLowerCase();
  if (asn && /^(13335|16509|14618|8075|15169|14061|63949)$/.test(asn)) return true;
  return /bot|crawler|spider|headless|curl|wget|python-requests|libwww|scrapy|phantom/.test(ua);
}

// ---------- coverage ----------

// Free-text location matching against the live shelf only. Nothing is inferred
// about counties we do not actually sell.
function matchCounty(stockPayload, text) {
  const q = clean(text, 200).toLowerCase();
  if (!q) return null;
  const counties = (stockPayload && stockPayload.counties) || [];
  for (const c of counties) {
    const name = String(c.county || "").toLowerCase();
    if (!name) continue;
    if (q === name || q.includes(name)) return c;
    // "Miami" should match "Miami-Dade"; "Dade" should too.
    for (const part of name.split(/[-\s]+/)) {
      if (part.length >= 4 && q.includes(part)) return c;
    }
  }
  // Well-known cities inside live counties, so "Orlando" resolves to Orange.
  const cities = {
    orlando: "Orange", kissimmee: "Orange", winterpark: "Orange",
    miami: "Miami-Dade", hialeah: "Miami-Dade", homestead: "Miami-Dade",
    "fort lauderdale": "Broward", hollywood: "Broward", pompano: "Broward",
    "deerfield beach": "Broward", "capecoral": "Lee", "cape coral": "Lee",
    "fort myers": "Lee", bonita: "Lee",
  };
  for (const [city, county] of Object.entries(cities)) {
    if (q.includes(city)) {
      const hit = counties.find((c) => String(c.county).toLowerCase() === county.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

const liveCountyNames = (s) => ((s && s.counties) || []).map((c) => c.county);

function coverageSentence(s) {
  const names = liveCountyNames(s);
  if (!names.length) return "The live shelf is temporarily unavailable, so we are not quoting inventory right now.";
  return `We are live in ${names.join(", ")}.`;
}

function countyStockSentence(hit) {
  return `${hit.county}: ${hit.single} single-signal and ${hit.cross} cross-verified records on the shelf right now. That is live inventory, not a forecast.`;
}

function priceSentence(s) {
  const t = (s && s.tiers) || {};
  const single = t.single || {}; const cross = t.cross || {};
  if (!single.price || !cross.price) return "";
  return `Single signal is $${single.price} per record. Cross-verified is $${cross.price}.`;
}

// ---------- demand capture ----------

async function upsertBuyerLead({ email, counties, volume, source, status, notes, referrer, ip, ua }) {
  await d1(
    `INSERT INTO buyer_leads (email, counties, volume, source, referrer, ip, user_agent, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       counties   = excluded.counties,
       volume     = excluded.volume,
       source     = excluded.source,
       referrer   = COALESCE(NULLIF(excluded.referrer,''), buyer_leads.referrer),
       status     = excluded.status,
       notes      = excluded.notes,
       requests   = buyer_leads.requests + 1,
       updated_at = datetime('now')`,
    [
      clean(email, 254).toLowerCase(), clean(counties, 300), clean(volume, 60),
      clean(source, 40) || "landing", clean(referrer, 500), clean(ip, 60), clean(ua, 300),
      clean(status, 30) || "new", clean(notes, 300),
    ]
  );
}

// Every send from the landing project is mirrored into email_log, so the owner
// panel and digest count landing mail the same way they count app mail.
async function logEmail({ to, kind, subject, status, error, providerMessageId }) {
  try {
    await d1(
      `INSERT INTO email_log (to_email, kind, subject, provider_message_id, status, error, sent_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [
        clean(to, 254).toLowerCase(), clean(kind, 40), clean(subject, 200),
        providerMessageId ? clean(providerMessageId, 120) : null,
        clean(status, 20), error ? clean(error, 300) : null,
      ]
    );
  } catch (e) {
    // Logging must never break delivery.
    console.error("[funnel] email_log write failed:", e.message);
  }
}

async function sendMail({ to, subject, text, attachments, kind }) {
  if (!process.env.AGENTMAIL_API_KEY) {
    await logEmail({ to, kind, subject, status: "skipped", error: "AGENTMAIL_API_KEY not set" });
    return { sent: false, skipped: "AGENTMAIL_API_KEY not set" };
  }
  const payload = { to: [clean(to, 254)], subject, text };
  if (attachments && attachments.length) payload.attachments = attachments;
  let r;
  try {
    r = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(INBOX)}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${String(process.env.AGENTMAIL_API_KEY).trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    await logEmail({ to, kind, subject, status: "failed", error: String(e.message || e) });
    return { sent: false, error: String(e.message || e) };
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = `agentmail ${r.status}: ${JSON.stringify(body).slice(0, 160)}`;
    await logEmail({ to, kind, subject, status: "failed", error: err });
    return { sent: false, error: err };
  }
  const id = body.message_id || body.messageId || null;
  await logEmail({ to, kind, subject, status: "sent", providerMessageId: id });
  return { sent: true, message_id: id };
}

// ---------- the two outcomes ----------

// In coverage: pull 10 live rows and email the CSV.
async function deliverSample({ email, counties, volume, source, referrer, ip, ua }) {
  const adminKey = process.env.LM_API_KEY || process.env.CHAT_ADMIN_API_KEY;
  if (!adminKey) throw new Error("sample delivery is not configured");

  const s = await stock();
  const hit = matchCounty(s, counties);
  const url = new URL("https://leadmachine-gamma.vercel.app/api/export");
  url.searchParams.set("limit", "10");
  if (hit) url.searchParams.set("county", hit.county);

  const csvRes = await fetch(url, { headers: { "x-api-key": adminKey } });
  if (!csvRes.ok) throw new Error(`sample export failed (${csvRes.status})`);
  const csv = await csvRes.text();

  await upsertBuyerLead({
    email, counties, volume, source, referrer, ip, ua,
    status: "new", notes: `sample requested for ${hit ? hit.county : "all live counties"}`,
  });

  const where = hit ? hit.County || hit.county : "Florida";
  const mail = await sendMail({
    to: email,
    kind: "landing_sample",
    subject: "Your LeadMachine sample is ready",
    text:
      `Attached are 10 live records for ${where}.\n\n` +
      (hit ? `${countyStockSentence(hit)}\n\n` : "") +
      `Every row carries the address, owner name where the tax roll matched, case reference and case age.\n` +
      `We sell data only and never contact the property owners in your list.\n\n` +
      `Reply to this email if you want a different county or a larger batch.`,
    attachments: [{
      content: Buffer.from(csv, "utf8").toString("base64"),
      filename: "leadmachine-sample.csv",
      content_type: "text/csv",
    }],
  });
  if (!mail.sent) throw new Error(mail.error || mail.skipped || "sample email failed");

  await d1(
    `UPDATE buyer_leads SET status='sampled', sample_sent_at=datetime('now'), notes=? WHERE email=?`,
    [`sample delivered for ${hit ? hit.county : "all live counties"} via ${clean(source, 20)}`, clean(email, 254).toLowerCase()]
  );
  return { county: hit ? hit.county : null, stock: s };
}

// Out of coverage: never drop it. Log demand, tell the truth, send a real email.
async function captureOutOfCoverage({ email, requested, volume, source, referrer, ip, ua }) {
  const s = await stock().catch(() => ({ counties: [] }));
  const names = liveCountyNames(s);

  await upsertBuyerLead({
    email, counties: requested, volume, source, referrer, ip, ua,
    status: "waitlist", notes: `out-of-coverage demand: ${clean(requested, 120)}`,
  });

  if (validEmail(email)) {
    await sendMail({
      to: email,
      kind: "landing_waitlist",
      subject: `We are not in ${clean(requested, 60)} yet`,
      text:
        `Thanks for asking about ${clean(requested, 60)}.\n\n` +
        `We are not there yet, so we are not going to sell you a list we cannot stand behind. ` +
        `Your request is logged and you are on the list for that market.\n\n` +
        (names.length ? `Live today: ${names.join(", ")}. Reply and we will send a free 10-record sample from any of them.\n\n` : "") +
        `We only sell counties we actually harvest.`,
    });
  }

  await notifyTelegram(
    `LeadMachine out-of-coverage demand\nMarket: ${clean(requested, 80)}\nEmail: ${clean(email, 120) || "(not given)"}\nSource: ${clean(source, 30)}`
  );
  return { live: names, stock: s };
}

async function notifyTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
  }).catch(() => {});
}

export {
  clean, validEmail, d1, stock, isBot,
  matchCounty, liveCountyNames, coverageSentence, countyStockSentence, priceSentence,
  upsertBuyerLead, logEmail, sendMail, deliverSample, captureOutOfCoverage, notifyTelegram,
};
