// POST /api/ingest — called by a café's PP app.
// Auth: `Authorization: Bearer <site ingest token>` (from scripts/create-site.mjs).
// The token identifies the site, so the body never carries a site_id.
//
// Body:
//   { "type": "daily_close", "business_date": "2026-09-29",
//     "revenue": 4210.50, "costs": 1830.00, "covers": 212 }
// or any other event type, which is just logged:
//   { "type": "waste_log", "occurred_at": "2026-09-29T14:02:00Z", "payload": {...} }
import { db, bearer, hashToken, cors } from './_lib.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v, field, errors) {
  if (v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) errors.push(`${field} must be a non-negative number`);
  return n;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const sql = db();
  const [site] = await sql`
    SELECT id FROM sites WHERE ingest_token_hash = ${hashToken(token)} AND active`;
  if (!site) return res.status(401).json({ error: 'Unknown or inactive site token' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!type) return res.status(400).json({ error: 'type is required' });

  if (type === 'daily_close') {
    const errors = [];
    if (!DATE_RE.test(body.business_date || '')) errors.push('business_date must be YYYY-MM-DD');
    const revenue = num(body.revenue, 'revenue', errors);
    const costs = num(body.costs, 'costs', errors);
    const covers = num(body.covers, 'covers', errors);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    await sql.transaction([
      sql`
        INSERT INTO daily_site_metrics (site_id, business_date, revenue, costs, covers)
        VALUES (${site.id}, ${body.business_date}, ${revenue}, ${costs}, ${Math.round(covers)})
        ON CONFLICT (site_id, business_date) DO UPDATE
          SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs,
              covers = EXCLUDED.covers, updated_at = now()`,
      sql`
        INSERT INTO events (site_id, type, occurred_at, payload)
        VALUES (${site.id}, 'daily_close', now(), ${JSON.stringify(body)})`,
    ]);
    return res.status(200).json({ ok: true, site_id: site.id, business_date: body.business_date });
  }

  const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'occurred_at is not a valid timestamp' });

  await sql`
    INSERT INTO events (site_id, type, occurred_at, payload)
    VALUES (${site.id}, ${type}, ${occurredAt.toISOString()}, ${JSON.stringify(body.payload ?? {})})`;
  return res.status(200).json({ ok: true, site_id: site.id, type });
}
