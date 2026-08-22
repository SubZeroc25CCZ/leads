// POST /api/chat — the concierge.
//
// ARCHITECTURE: intent first, state second.
//
// The previous version was a slot machine: whatever you typed was cast into the
// slot the server happened to be waiting for. "hi" became a county ("We are not
// in hi yet"), then "new york" became a volume ("Good."). The state machine was
// the authority and the message had no say.
//
// Now every message goes through one classification pass that decides what the
// message *is* and pulls out any fields it happens to contain. The state
// machine's only remaining job is to notice which fields are still missing and
// ask for the next one. A message is never force-cast into an awaited slot, so
// a greeting is a greeting at any step and an out-of-coverage market is honest
// at any step.
//
// The client sends back the collected fields each turn, so this stays stateless
// (no session store) while behaving like a conversation. Client-supplied fields
// are re-validated here; the client is never trusted as the authority.
//
// HOUSE VOICE: the brand speaks as "we". No personal name ever appears in
// buyer-facing copy or escalation text.

import {
  clean, validEmail, isBot, stock, matchCounty, liveCountyNames,
  coverageSentence, countyStockSentence, priceSentence,
  deliverSample, captureOutOfCoverage, notifyTelegram,
} from "./_funnel.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const INTENTS = ["greeting", "location", "volume", "email", "question", "out_of_coverage", "other"];

function faqPack(s) {
  const counties = (s.counties || []).map((c) => `${c.county}: ${c.single} single-signal, ${c.cross} cross-verified, ${c.total} total`).join("; ");
  const t = s.tiers || {};
  return [
    `LeadMachine sells Florida public-record property distress data to investors and wholesalers.`,
    `LIVE COUNTIES AND STOCK (the only inventory that exists): ${counties || "temporarily unavailable"}.`,
    t.single && t.cross ? `PRICING: single-signal $${t.single.price} per record; cross-verified $${t.cross.price} per record. No public enterprise pricing.` : "",
    `A record contains: lead reference, owner name (where the tax roll matched), property address, city, state, ZIP, county, signals, case opened date, case age, mailing state, first seen, outcome link.`,
    `Owner and mailing data is verified against Florida Property Appraiser tax rolls where available.`,
    `A free 10-record sample is available. We never contact property owners; the buyer owns all outreach and its compliance.`,
    `Teams can request a pilot at /partners. Enterprise pricing is a conversation, never published.`,
  ].filter(Boolean).join("\n");
}

// One call: classify the intent and extract any fields present.
async function classify(message, collected, s) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const system = [
    `You are the routing layer for LeadMachine's website concierge.`,
    `Classify the buyer's message and extract any fields it contains. Reply with STRICT JSON only, no prose and no code fences.`,
    ``,
    `Schema:`,
    `{"intent":"greeting|location|volume|email|question|out_of_coverage|other","county":"<live county name or empty>","raw_location":"<place they named, or empty>","volume":"<volume they stated, or empty>","email":"<email, or empty>","answer":"<reply, only when intent is question or greeting; else empty>"}`,
    ``,
    `Rules:`,
    `- "location" ONLY when they name a place we actually sell. Put the matched live county in "county".`,
    `- "out_of_coverage" when they name any real place we do NOT sell (any other state, county, city or country). Put what they named in "raw_location". This applies at ANY point in the conversation.`,
    `- "greeting" for hi/hello/hey/thanks and similar. Never treat a greeting as a place or a volume.`,
    `- "volume" only for a quantity of leads. Never treat a place name as a volume.`,
    `- "question" for anything asking about price, data, coverage, process, legality or delivery. Answer it in "answer" using ONLY the grounding pack below.`,
    `- "other" if genuinely unclear. Leave "answer" empty.`,
    ``,
    `Voice for "answer": short sentences, plain and direct. Speak as "we" for the company.`,
    `Never state a personal name. Never invent inventory, counties, prices, timelines or delivery promises.`,
    `Known product facts you MAY state: single-signal $15/lead (score 15-24); cross-verified $30/lead (score 25-40, owner verified vs Property Appraiser); free 10-record sample, no card; delivery = CSV by email within minutes; exclusive/standing orders priced per county+volume -> point to /partners.`,
    `Tone: sharp warm concierge; 1-2 short sentences; answer first, max one follow-up question; never sound like a form.`,
    `Only cite numbers present in the grounding pack. If asked something the pack cannot answer, set intent "other" and leave "answer" empty.`,
    ``,
    `GROUNDING PACK:`,
    faqPack(s),
    ``,
    `Already collected (do not ask for these again): ${JSON.stringify(collected)}`,
  ].join("\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": String(process.env.ANTHROPIC_API_KEY).trim(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: clean(message, 1000) }],
    }),
  });

  if (!r.ok) {
    // Loud, not silent. A wrong model name previously degraded every freeform
    // answer to canned copy with nobody noticing.
    const detail = await r.text().catch(() => "");
    console.error(`[chat] classifier HTTP ${r.status} model=${MODEL} ${detail.slice(0, 200)}`);
    return null;
  }

  const body = await r.json();
  const text = (body.content || []).map((x) => x.text || "").join("").trim();
  const jsonText = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (!INTENTS.includes(parsed.intent)) parsed.intent = "other";
    return parsed;
  } catch {
    console.error(`[chat] classifier returned non-JSON: ${text.slice(0, 200)}`);
    return null;
  }
}

// Deterministic fallback used when the classifier is unavailable. Deliberately
// conservative: it recognises only what it can prove, and never guesses a slot.
function heuristic(message, s) {
  const m = clean(message, 300);
  const low = m.toLowerCase();
  const out = { intent: "other", county: "", raw_location: "", volume: "", email: "", answer: "" };

  const emailMatch = m.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/);
  if (emailMatch) { out.intent = "email"; out.email = emailMatch[0]; return out; }

  if (/^(hi|hey|hello|yo|sup|good (morning|afternoon|evening)|thanks|thank you|ok|okay)\b/.test(low)) {
    out.intent = "greeting"; return out;
  }

  const hit = matchCounty(s, m);
  if (hit) { out.intent = "location"; out.county = hit.county; return out; }

  // A bare number, or a number with a lead/month word, is a volume.
  if (/^\d[\d\s,\-–]*(\+|leads?|per month|\/mo|a month)?$/i.test(low)) {
    out.intent = "volume"; out.volume = m; return out;
  }
  if (/\b(lead|leads|record|records)\b/.test(low) && /\d/.test(low)) {
    out.intent = "volume"; out.volume = m; return out;
  }

  if (/\?|how much|price|pricing|cost|what is|what's|do you|can i|which/.test(low)) {
    out.intent = "question"; return out;
  }

  // Looks like a place we do not serve: alphabetic, no digits, not a known slot.
  if (/^[a-z][a-z\s.,'-]{2,40}$/i.test(m) && !/\d/.test(m)) {
    out.intent = "out_of_coverage"; out.raw_location = m; return out;
  }
  return out;
}

const ASK_COUNTY = "Which county or ZIP do you buy in?";
const ASK_VOLUME = "How many leads do you want to start with?";
const ASK_EMAIL = "What work email should the 10-record sample go to?";

// The state machine's entire remaining job: what is still missing?
function nextQuestion(c) {
  if (!c.county) return ASK_COUNTY;
  if (!c.volume) return ASK_VOLUME;
  if (!c.email) return ASK_EMAIL;
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  const ip = clean(String(req.headers["x-forwarded-for"] || "").split(",")[0], 60);
  const ua = clean(req.headers["user-agent"], 300);

  try {
    const s = await stock();
    const message = clean(body.message, 1000);

    // Fields collected so far, re-validated rather than trusted.
    const collected = {
      county: clean(body.county, 80),
      volume: clean(body.volume, 60),
      email: validEmail(clean(body.email, 254)) ? clean(body.email, 254).toLowerCase() : "",
    };

    // Bots never reach the classifier, so crawlers cannot spend tokens.
    if (isBot(req)) {
      return res.json({ ok: true, bot: true, collected, answer: `${coverageSentence(s)} ${priceSentence(s)} Ask us for a free 10-record sample and we will send live rows from any live county.`.trim(), stock: s });
    }

    if (!message) {
      return res.json({ ok: true, collected, answer: `${coverageSentence(s)} ${ASK_COUNTY}`, stock: s });
    }

    // ---- intent first ----
    const read = (await classify(message, collected, s)) || heuristic(message, s);

    // Trust our own live shelf over the model for coverage decisions.
    const namedPlace = read.county || read.raw_location || (read.intent === "location" ? message : "");
    const hit = namedPlace ? matchCounty(s, namedPlace) : null;

    // Out of coverage is honest at ANY step, and is never dropped.
    if ((read.intent === "out_of_coverage" || (read.intent === "location" && !hit)) && namedPlace) {
      const requested = clean(read.raw_location || namedPlace, 80);
      if (collected.email) {
        await captureOutOfCoverage({
          email: collected.email, requested, volume: collected.volume,
          source: "chat", ip, ua,
        });
        return res.json({
          ok: true, covered: false, collected,
          answer: `We are not in ${requested} yet. We will not sell you a list we cannot stand behind. You are on the list for that market and the details are in your inbox. ${coverageSentence(s)} Want a free sample from one of those?`,
          stock: s,
        });
      }
      // No email yet: ask for it so the demand can actually be logged.
      return res.json({
        ok: true, covered: false, awaiting: "email_for_waitlist",
        collected: { ...collected, county: "", pending_location: requested },
        answer: `We are not in ${requested} yet, and we will not pretend otherwise. ${coverageSentence(s)} Leave your work email and we will add you to the list for ${requested}, or point you at a live county.`,
        stock: s,
      });
    }

    // Merge anything the message actually contained.
    if (hit) collected.county = hit.county;
    if (read.volume) collected.volume = clean(read.volume, 60);
    if (read.email && validEmail(read.email)) collected.email = clean(read.email, 254).toLowerCase();

    // An email arriving while a waitlist market is pending completes that path.
    const pendingLocation = clean(body.pending_location, 80);
    if (pendingLocation && collected.email) {
      await captureOutOfCoverage({
        email: collected.email, requested: pendingLocation, volume: collected.volume,
        source: "chat", ip, ua,
      });
      return res.json({
        ok: true, covered: false, collected: { ...collected, pending_location: "" },
        answer: `Logged. You are on the list for ${pendingLocation} and we have emailed you the details. ${coverageSentence(s)} Say the word and we will send a free sample from one of those.`,
        stock: s,
      });
    }

    // Everything needed is present: deliver.
    if (collected.county && collected.volume && collected.email) {
      await deliverSample({
        email: collected.email, counties: collected.county, volume: collected.volume,
        source: "chat", ip, ua,
      });
      return res.json({
        ok: true, sent: true, collected,
        answer: `Sent. Ten live ${collected.county} records are in your inbox. Reply to that email if you want a different county or a bigger batch.`,
        stock: s,
      });
    }

    // Otherwise: acknowledge what this message was, then ask for what is missing.
    const missing = nextQuestion(collected);
    let lead = "";

    if (read.intent === "greeting") {
      lead = read.answer || `Hello. ${coverageSentence(s)}`;
    } else if (read.intent === "question") {
      if (read.answer) {
        lead = read.answer;
      } else {
        // No grounded answer available: escalate rather than improvise.
        await notifyTelegram(`LeadMachine chat escalation\nQuestion: ${message}\nNo grounded answer was available.`);
        lead = "That one needs a human. We have passed it on and you will hear back today.";
      }
    } else if (hit) {
      lead = countyStockSentence(hit);
    } else if (read.intent === "volume" && collected.volume) {
      lead = `${collected.volume} it is.`;
    } else if (read.intent === "email" && collected.email) {
      lead = "Got the email.";
    } else {
      lead = coverageSentence(s);
    }

    return res.json({ ok: true, collected, answer: `${lead} ${missing}`.trim(), stock: s });
  } catch (err) {
    console.error("[chat]", err);
    return res.status(502).json({
      error: "Something went wrong on our side. Leave your work email and we will follow up.",
    });
  }
}
