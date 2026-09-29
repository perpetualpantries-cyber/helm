// GET /api/canopy/summary?from=YYYY-MM-DD — Canopy's view across every client and site.
// Auth: `Authorization: Bearer <CANOPY_READ_TOKEN>`.
// `from` defaults to the start of the current Australian financial year (1 July).
import { db, bearer, safeEqual, cors } from '../_lib.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function financialYearStart(now = new Date()) {
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}-07-01`;
}

const money = (v) => Number(v || 0);

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const expected = process.env.CANOPY_READ_TOKEN;
  if (!expected) return res.status(500).json({ error: 'CANOPY_READ_TOKEN is not set' });
  if (!safeEqual(bearer(req), expected)) return res.status(401).json({ error: 'Invalid token' });

  const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from)
    ? req.query.from
    : financialYearStart();

  const sql = db();
  const rows = await sql`
    SELECT c.id AS client_id, c.name AS client_name,
           s.id AS site_id, s.name AS site_name, s.active,
           coalesce(sum(m.revenue), 0) AS revenue,
           coalesce(sum(m.costs), 0)   AS costs,
           coalesce(sum(m.covers), 0)  AS covers,
           max(m.business_date)::text  AS last_close
    FROM sites s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN daily_site_metrics m
      ON m.site_id = s.id AND m.business_date >= ${from}
    GROUP BY c.id, c.name, s.id, s.name, s.active
    ORDER BY c.name, s.name`;

  const clients = new Map();
  const totals = { revenue: 0, costs: 0, covers: 0, sites: 0, activeSites: 0 };
  for (const r of rows) {
    if (!clients.has(r.client_id)) {
      clients.set(r.client_id, { id: r.client_id, name: r.client_name, revenue: 0, costs: 0, covers: 0, sites: [] });
    }
    const c = clients.get(r.client_id);
    const site = {
      id: r.site_id,
      name: r.site_name,
      active: r.active,
      revenue: money(r.revenue),
      costs: money(r.costs),
      covers: Number(r.covers || 0),
      lastClose: r.last_close,
    };
    c.sites.push(site);
    c.revenue += site.revenue;
    c.costs += site.costs;
    c.covers += site.covers;
    totals.revenue += site.revenue;
    totals.costs += site.costs;
    totals.covers += site.covers;
    totals.sites += 1;
    if (site.active) totals.activeSites += 1;
  }

  return res.status(200).json({
    asOf: new Date().toISOString(),
    from,
    totals,
    clients: [...clients.values()],
  });
}
