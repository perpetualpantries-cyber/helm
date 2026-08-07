# Helm

Company-wide agent for Perpetual Pantries (PP). It sits **above** Canopy
(client ops), Ronin (per-org assistant), and Gavin (per-café assistant) —
its job is cross-functional: governance, sales/growth, finance/profitability,
and ops oversight, all in one place, with a single authority model: **act on
routine work, escalate the rest.**

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design —
where Helm sits relative to the rest of the stack, the four domains, the
auto-act/escalate rules, the data model, and what's stubbed vs. real today.

## Status

This is a working v1 scaffold, not a finished product:

- The agent loop, escalation gate, API, and dashboard are real and run
  end-to-end against Helm's own SQLite database.
- Helm does **not** yet read Canopy/Ronin/Gavin's live data (that app is
  client-side only today, storing to localStorage/JSONBin — there's no API
  to read from yet) or send real outbound messages (no email/SMS integration
  wired up). Both are seeded/stubbed with a documented integration seam —
  see the "What's real vs. stubbed" section in the architecture doc.
- PP currently has one verbal-agreement pilot client and no live POS/billing
  feed, so finance/profitability logic has real code behind it but nothing
  real to optimize against yet. It won't invent numbers to fill that gap.
- The authority thresholds are real, not placeholders: sales discounts of
  5% or less auto-approve; above 5% they escalate with a 4-day
  auto-execute countdown (goes through if not declined); everything else
  (governance, finance, contracts, spend, hiring) escalates with no timer.
  These came from `helm.html` (checked in at the repo root as reference) —
  see docs/ARCHITECTURE.md.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY and HELM_ADMIN_TOKEN
npm run seed            # populate starter data
npm run dev              # http://localhost:4000
```

Open `http://localhost:4000` for the dashboard. Paste your `HELM_ADMIN_TOKEN`
into the token field (top right) to approve/decline/edit queued items and to
trigger a manual review run.

Without `ANTHROPIC_API_KEY` set, the server still starts (API + dashboard
work against whatever's in the database) but the scheduler and `/api/review`
won't run — there's no model to call.

## Scripts

| Command         | What it does                                      |
|-----------------|----------------------------------------------------|
| `npm run dev`   | Run with hot reload (tsx watch)                    |
| `npm run build` | Type-check and compile to `dist/`                  |
| `npm start`     | Run the compiled build                              |
| `npm run seed`  | Seed starter data (no-ops if data already exists)  |
| `npm test`      | Run tests                                           |

## API

All endpoints are under `/api`. Mutating endpoints (`approve`/`decline`/`edit`/
`review`) require an `x-helm-token` header matching `HELM_ADMIN_TOKEN`.

- `GET  /api/actions?status=pending&domain=sales` — list logged actions
- `GET  /api/actions/:id`
- `POST /api/actions/:id/approve` `{ note? }`
- `POST /api/actions/:id/decline` `{ note? }`
- `POST /api/actions/:id/edit` `{ note?, payload }`
- `POST /api/review` — run all four domain reviews immediately
- `GET  /api/clients` `/api/quotes` `/api/invoices` `/api/compliance` `/api/leads` — read-only snapshots
