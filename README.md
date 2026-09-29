# Helm + Canopy data layer

`helm.html` is the oversight dashboard. The `api/` folder is the Canopy data layer: a Neon Postgres database behind two Vercel functions.

```
café PP app ──POST /api/ingest──▶ Neon (sites, daily_site_metrics, events)
                                         │
Helm (browser) ◀──GET /api/canopy/summary┘
```

Cafés only write to the database. Gavin (per site), Ronin (per client) and Canopy (all clients) read the same tables filtered by `site_id` or `client_id`. Nothing is passed agent to agent.

## Setup

1. Create a Neon database and apply the schema:
   ```sh
   npm install
   DATABASE_URL=postgres://... npm run db:schema
   ```
2. Deploy this repo to Vercel with these environment variables:
   - `DATABASE_URL`: the Neon connection string
   - `CANOPY_READ_TOKEN`: a long random string that Helm uses to read
   - `CANOPY_ALLOWED_ORIGIN` (optional): restricts CORS; defaults to `*`
3. Register each café. This prints its ingest token once:
   ```sh
   DATABASE_URL=postgres://... npm run site:create -- "Client name" "Site name"
   ```
4. In Helm, open **Finance → Live site data**, then enter the Vercel URL and `CANOPY_READ_TOKEN`.

## What a café sends

End-of-day close. Re-sending the same date overwrites it, so retries are safe:

```sh
curl -X POST https://<project>.vercel.app/api/ingest \
  -H "Authorization: Bearer pps_..." -H "Content-Type: application/json" \
  -d '{"type":"daily_close","business_date":"2026-09-29","revenue":4210.50,"costs":1830,"covers":212}'
```

Any other `type` (such as `waste_log` or `stock_count`) is stored in `events` with its `payload`, ready for later tables.

`GET /api/canopy/summary?from=YYYY-MM-DD` returns totals per client and per site. `from` defaults to the start of the Australian financial year (1 July).
