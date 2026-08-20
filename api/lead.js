// POST /api/lead — the #claim form on the landing page.
//
// This is the same funnel the concierge uses, not a parallel one: identical bot
// filter, identical coverage honesty, identical sample delivery and email_log
// provenance. See api/_funnel.js.
//
// Outcomes:
//   in coverage      -> buyer_leads row + 10-record CSV emailed   -> { ok, sent:true }
//   out of coverage  -> buyer_leads row (waitlist) + honest email -> { ok, covered:false }
//   bot              -> recorded quietly, no export, no mail      -> { ok, bot:true }
//
// Required env: CF_ACCOUNT_ID, CF_API_TOKEN, LM_API_KEY, AGENTMAIL_API_KEY.

import {
  clean, validEmail, isBot, stock, matchCounty,
  deliverSample, captureOutOfCoverage, upsertBuyerLead,
} from "./_funnel.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const email = clean(body.email, 254).toLowerCase();
  const counties = clean(body.counties, 300);
  const volume = clean(body.volume, 60);
  const source = clean(body.source, 40) || "landing_claim";
  const referrer = clean(body.referrer, 500);
  const ip = clean(String(req.headers["x-forwarded-for"] || "").split(",")[0], 60);
  const ua = clean(req.headers["user-agent"], 300);

  // The client validates too, but the client is not the authority.
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid work email address." });
  if (counties.length < 2) return res.status(400).json({ error: "Add at least one county or ZIP." });

  // Durable capture line: survives even if every downstream call fails.
  console.log("LEAD_CAPTURE " + JSON.stringify({ email, counties, volume, source, at: new Date().toISOString() }));

  // Bots are recorded but never trigger an export or an email.
  if (isBot(req)) {
    await upsertBuyerLead({
      email, counties, volume, source: "bot", referrer, ip, ua,
      status: "filtered", notes: "automated submission, no sample sent",
    }).catch(() => {});
    return res.status(200).json({ ok: true, bot: true, message: "Request received." });
  }

  try {
    const s = await stock();
    const hit = matchCounty(s, counties);

    if (!hit) {
      // Honesty path — identical to the concierge. Never silently dropped.
      const out = await captureOutOfCoverage({ email, requested: counties, volume, source, referrer, ip, ua });
      const live = out.live.length ? ` We are live in ${out.live.join(", ")}.` : "";
      return res.status(200).json({
        ok: true,
        covered: false,
        message: `We are not in ${counties} yet, so we did not send a list we cannot stand behind. You are on the list and the details are in your inbox.${live}`,
      });
    }

    await deliverSample({ email, counties, volume, source, referrer, ip, ua });
    return res.status(200).json({
      ok: true,
      covered: true,
      sent: true,
      county: hit.county,
      message: `Sample sent — check your inbox. Ten live ${hit.county} records are on their way.`,
    });
  } catch (err) {
    console.error("[api/lead]", err);
    // A delivery failure must not lose the buyer.
    await upsertBuyerLead({
      email, counties, volume, source, referrer, ip, ua,
      status: "new", notes: `delivery failed: ${clean(err.message, 160)}`,
    }).catch(() => {});
    return res.status(502).json({
      error: "We saved your request but could not send the sample just now. We will follow up by email shortly.",
    });
  }
}
