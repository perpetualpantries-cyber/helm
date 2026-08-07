# Helm — architecture

This document started because the original planning session (a voice call)
produced a spec file (`helm-backend-spec.md`) and a mockup (`helm.html`)
saved to that app's own sandbox — not reachable from the Claude Code
session that did this build. `helm.html` was later recovered (pushed
straight to `main` in this repo) and is checked in at the repo root as a
reference — it's a client-side, single-file mockup with its own
`window.storage`-backed state and direct browser calls to the Anthropic
API, not something this service runs, but it's the actual source for the
authority model below (the 5%/4-day rule, the tool set, the leads
workflow) — those are Josh's own design, not something reconstructed from
memory. `helm-backend-spec.md` itself never surfaced; this doc is what
stands in for it.

## Where Helm sits

```
Helm — company-wide, cross-functional, profit-optimizing
  │
  ▼
Canopy — PP Command Client Ops (sales, quoting, billing, team/ops)
  │
  ▼
Ronin — per-org assistant (one client, all their sites)
  │
  ▼
Gavin — per-site assistant (one café)
```

Helm is a new, standalone service (this repo) — it does not replace or live
inside Canopy/Ronin/Gavin (`PPrefactored`, a single client-side HTML app).
It's positioned to eventually act *through* Canopy's tools and data (quotes,
clients, billing) rather than duplicating them, plus own two domains Canopy
doesn't have today: governance/compliance and finance/profitability
strategy. See "What's real vs. stubbed" below for how far that goes today.

## The four domains

1. **Sales & growth** — chasing pending quotes, prioritizing follow-ups,
   adjusting price within an existing band.
2. **Finance / profitability** — rolling cost-of-sale up against revenue,
   spotting margin problems, recommending pricing/resourcing calls. Real
   logic, but PP has ~no live revenue data yet, so it's scaffolded and
   deliberately inert until real numbers exist (see below) — it will not
   fabricate a business case from placeholder data.
3. **Governance / compliance** — company-level: contract terms, IP
   assignment with developers, DPA/privacy obligations, ASIC/company-law
   housekeeping. Distinct from the café-facing OHS/temp-log compliance
   Gavin already handles per site.
4. **Ops** — oversight of team/schedule/ordering, which Canopy owns. Helm
   has no write access here and, as of this build, no read integration
   either — it can only flag things once that integration exists.

## Authority model

Reuses the approval-gate shape already used for Canopy → Ronin, one level
up: **act on routine, escalate the rest.** The specific thresholds below
are Josh's own rules from `helm.html`, not invented defaults.

- **Auto-act**: routine quote follow-ups, invoice reminders (within
  overdue/reminder-count limits), compliance-deadline flags, margin flags,
  logging/contacting leads — anything with no external commitment and a
  clear, bounded effect. **Sales discounts of 5% off list or less** are
  explicitly in this bucket: `sales:propose_sales_discount` auto-approves
  at ≤5% (`SALES_DISCOUNT_AUTO_APPROVE_MAX_PCT` in `src/agent/gate.ts`).
- **Escalate, with a timer** — sales discounts *above* 5% are the one
  exception to "escalations wait for a human": they queue with a **4-day
  auto-execute countdown** (`actions.auto_execute_at`, swept every 15 min
  by `startAutoExecuteSweep` in `src/scheduler/index.ts`) and go through on
  their own unless declined in that window. This is deliberate — Josh's
  design treats an un-answered sales discount as tacit approval, unlike
  everything else.
- **Escalate, no timer**: anything touching contract terms, pricing
  outside a quote's band, hiring/spend commitments, legal language,
  write-offs, or — critically — **any action type the model hasn't used
  before**. These only proceed on explicit approval; silence means nothing
  happens.
- Every escalated item lands in a queue (`GET /api/actions?status=pending`,
  rendered in the dashboard, with a countdown shown when one applies) with
  the agent's own recommendation attached — approve / decline / edit, not
  an open-ended question back to the human.

The classification — including which action types get a timer — is
enforced in code (`src/agent/gate.ts`, `src/agent/execute.ts`), not left to
the model's judgment on a given turn — the system prompt tells the model
this explicitly, so it proposes freely instead of hedging.

## Data model

Helm keeps its own SQLite database (`src/db/schema.sql`):

- `clients`, `quotes`, `invoices`, `compliance_items`, `leads` — the
  working data each domain reasons over. `leads` is top-of-funnel
  (name/company/email/source/status) and separate from `quotes`, matching
  the pipeline-vs-leads split in `helm.html`.
- `actions` — the full audit/escalation log. Every action the agent
  proposes lands here, whether it executed immediately (`auto_executed`)
  or is waiting on a human (`pending` → `approved` / `declined` /
  `edited` / `timed_out`). `auto_execute_at` is set only for the one
  timed-escalation case (sales discounts >5%) — see Authority model above.
- `settings` — reserved for tunable thresholds (pricing bands, overdue
  cutoffs) if/when those need to move out of code.

## The review loop

`src/agent/review.ts` runs all four domains each cycle. Per domain:

1. Build a JSON snapshot from Helm's own DB (`src/domains/<domain>.ts`).
2. Call Claude with that snapshot and a domain-specific system prompt
   (`src/agent/prompts.ts`), giving it one tool: `propose_action`.
3. For each proposed action, `src/agent/gate.ts` classifies it auto vs.
   escalate from fixed rules (never from the model's own say-so), and
   `src/agent/execute.ts` either runs the domain's `execute()` immediately
   or queues it.
4. A scheduler (`src/scheduler/index.ts`, `node-cron`, default every 30
   minutes via `HELM_REVIEW_CRON`) triggers this automatically; `POST
   /api/review` triggers it on demand.

This is a bounded "snapshot in, propose_action calls out" loop rather than a
free-roaming multi-tool agent — deliberate for v1: it keeps every action
traceable to a specific DB read and a specific rule, which matters more here
than open-ended exploration does.

## What's real vs. stubbed

Built and working end-to-end:
- The agent loop, gate, scheduler, REST API, and approval-queue dashboard.
- Domain logic that reads/writes Helm's own DB (marking a quote followed
  up, bumping an invoice's reminder count, flagging a compliance item).

Deliberately stubbed, with the seam named so it's a small change, not a
rewrite:
- **Outbound sends** (`src/integrations/notify.ts`) — "sending" a follow-up
  or reminder today drafts it and logs it; nothing leaves PP yet. Wire this
  to Gmail (available via MCP in Claude Code sessions on this account) or a
  transactional-email provider when PP wants unattended sends.
- **Reading Canopy/Ronin/Gavin's live data** — `PPrefactored` is a
  single-file client-side app with localStorage/JSONBin storage, not an
  API. Helm's `clients`/`quotes`/`invoices` tables are its own store, seeded
  by hand or via `/api` for now. The integration path once it's worth
  building: either (a) Canopy exports/syncs into Helm's tables, or (b)
  Canopy grows a small read API Helm polls. Until then, don't point Helm's
  finance domain at real revenue conclusions — there isn't real revenue
  data behind it.
- **Xero / Lightspeed** — mentioned in the original call as inputs to
  margin and invoicing; no integration exists yet. `finance.ts` is
  structured so a real feed slots into `buildSnapshot()` without changing
  the review loop.
- **Lead discovery and outreach** — `helm.html` gives Helm a `web_search`
  tool for finding leads and a Gmail MCP connection for drafting outreach
  (never sending — the mockup itself is explicit that there's no send
  tool). This build has `log_lead`/`mark_lead_contacted` and the `leads`
  table, but the review loop doesn't yet call a web-search tool or draft
  real emails — `mark_lead_contacted` logs the decision through the same
  `notify.ts` stub as everything else. Adding Claude's web-search tool to
  the sales domain's tool list and a Gmail draft-creation call in
  `notify.ts` are the concrete next steps here, not a redesign.

## Open decisions (carried over from the call, still open)

- Whether Helm eventually calls Canopy's tools directly (needs an API
  Canopy doesn't have yet) versus each system staying in its own store with
  scheduled sync.
- Pricing-band values and overdue/reminder thresholds in `gate.ts` are
  reasonable defaults, not confirmed business policy — worth a deliberate
  pass once there's real quote/invoice history to tune against.
- Auth is a single shared admin token (`HELM_ADMIN_TOKEN`), appropriate for
  a single-operator app today; revisit if more than one person needs
  distinguishable approval identity.
