// POST /api/lead  — captures a free-sample request into Cloudflare D1.
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   CF_ACCOUNT_ID    Cloudflare account ID
//   CF_API_TOKEN     API token with "D1 Edit" on the leadmachine-db database
// Optional:
//   CF_D1_DATABASE_ID   defaults to the leadmachine-db id below
//   NOTIFY_WEBHOOK      n8n (or any) webhook URL, fired async on each new lead

const DEFAULT_DB = 'bce5b2af-1852-4aa0-a084-ecba3d3f3933'; // leadmachine-db

async function d1(sql, params) {
  const acct = process.env.CF_ACCOUNT_ID;
  const db = process.env.CF_D1_DATABASE_ID || DEFAULT_DB;
  const token = process.env.CF_API_TOKEN;
  if (!acct || !token) throw new Error('D1 credentials not configured');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${db}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  const body = await res.json();
  if (!res.ok || body.success === false) {
    const detail = (body.errors && body.errors[0] && body.errors[0].message) || res.status;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return body.result;
}

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    const email = clean(body.email, 254).toLowerCase();
    const counties = clean(body.counties, 300);
    const volume = clean(body.volume, 40);
    const source = clean(body.source, 40) || 'landing';
    const referrer = clean(body.referrer, 500);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (counties.length < 2) {
      return res.status(400).json({ error: 'Add at least one county or ZIP.' });
    }

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      '';
    const ua = clean(req.headers['user-agent'], 300);

    // Durable capture line — swept into D1 by the ops automation even when
    // direct D1 credentials are absent or the write below fails.
    console.log('LEAD_CAPTURE ' + JSON.stringify({ email, counties, volume, source, referrer, ip, ua, at: new Date().toISOString() }));

    // Upsert: repeat requests update the record instead of duplicating it.
    try {
      await d1(
        `INSERT INTO buyer_leads
           (email, counties, volume, source, referrer, ip, user_agent, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'))
         ON CONFLICT(email) DO UPDATE SET
           counties   = excluded.counties,
           volume     = excluded.volume,
           referrer   = excluded.referrer,
           updated_at = datetime('now'),
           requests   = requests + 1`,
        [email, counties, volume, source, referrer, ip, ua]
      );
    } catch (dbErr) {
      // The LEAD_CAPTURE log above is the fallback of record — never bounce
      // a real buyer because storage credentials are missing.
      console.error('[api/lead] D1 write failed, captured via log:', dbErr.message);
    }

    // Fire-and-forget notification so a new buyer never sits unseen.
    if (process.env.NOTIFY_WEBHOOK) {
      fetch(process.env.NOTIFY_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'sample_request', email, counties, volume, source }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/lead]', err);
    return res.status(500).json({ error: 'Could not save the request. Try again shortly.' });
  }
}
