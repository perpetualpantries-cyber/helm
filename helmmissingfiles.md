# Helm — missing files to create on GitHub

For each entry below: on GitHub, click **Add file -> Create new file**, paste the **path** into the filename box at the top (it auto-creates folders), paste the **content** into the editor, then commit directly to `claude/company-profit-agent-tjn1w4`. You can create several before committing by using 'Add file' again from the same page in some GitHub UIs, but if unsure, just commit after each one individually - that's fine.

---

## `.gitignore`

```text
node_modules/
dist/
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
.env
*.log

```

---

## `.env.example`

```text
# Anthropic API key used server-side by Helm's agent loop.
ANTHROPIC_API_KEY=sk-ant-...

# Model used for domain review runs. Defaults to a Claude model if unset.
HELM_MODEL=claude-sonnet-5

# Shared secret required in the `x-helm-token` header to approve/decline/edit
# queued actions or trigger a manual review run. Single-operator app, so one
# shared secret is enough for v1 — replace with real auth before adding users.
HELM_ADMIN_TOKEN=change-me

# HTTP port for the API + dashboard.
PORT=4000

# SQLite file path. A single file is enough for v1; move to Postgres if/when
# Helm needs to run across multiple processes or survive disk loss.
HELM_DB_PATH=./data/helm.db

# Cron schedule for the automatic domain review sweep (node-cron syntax).
# Default: every 30 minutes.
HELM_REVIEW_CRON=*/30 * * * *

```

---

## `src/index.ts`

```ts
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db/db.js'; // runs the migration as a side effect
import { router } from './api/routes.js';
import { startReviewScheduler, startAutoExecuteSweep } from './scheduler/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use('/api', router);
app.use('/', express.static(path.join(__dirname, '../public')));

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Helm listening on :${port}`);
  startAutoExecuteSweep();
  if (process.env.ANTHROPIC_API_KEY) {
    startReviewScheduler();
  } else {
    console.warn('[startup] ANTHROPIC_API_KEY not set — domain review scheduler disabled. The API, dashboard, and timed-escalation sweep still work.');
  }
});

```

---

## `src/types.ts`

```ts
export type Domain = 'sales' | 'finance' | 'governance' | 'ops';

export type Risk = 'auto' | 'escalate';

export type ActionStatus = 'pending' | 'auto_executed' | 'approved' | 'declined' | 'edited' | 'timed_out';

export interface ActionRow {
  id: number;
  domain: Domain;
  action_type: string;
  summary: string;
  recommendation: string | null;
  payload_json: string;
  risk: Risk;
  status: ActionStatus;
  resolution_note: string | null;
  auto_execute_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ProposedAction {
  domain: Domain;
  action_type: string;
  summary: string;
  recommendation?: string;
  payload?: Record<string, unknown>;
}

export interface ClientRow {
  id: number;
  name: string;
  tier: 'standard' | 'priority' | 'pilot';
  status: 'prospect' | 'pilot' | 'active' | 'churned';
  contract_terms: string | null;
  site_count: number;
  created_at: string;
  updated_at: string;
}

export interface QuoteRow {
  id: number;
  client_id: number;
  status: 'pending' | 'sent' | 'accepted' | 'declined' | 'expired';
  amount_cents: number;
  cost_of_sale_cents: number;
  pricing_band_min_cents: number | null;
  pricing_band_max_cents: number | null;
  requested_at: string;
  followed_up_at: string | null;
  sent_at: string | null;
  decided_at: string | null;
  notes: string | null;
}

export interface InvoiceRow {
  id: number;
  client_id: number;
  amount_cents: number;
  due_date: string;
  status: 'pending' | 'reminded' | 'paid' | 'overdue' | 'write_off_candidate';
  last_reminded_at: string | null;
  reminder_count: number;
  created_at: string;
}

export interface LeadRow {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  source: string | null;
  status: 'new' | 'contacted' | 'replied' | 'lost';
  notes: string | null;
  found_at: string;
  contacted_at: string | null;
}

export interface ComplianceRow {
  id: number;
  title: string;
  category: 'company_law' | 'contracts' | 'dpa_privacy' | 'ip_assignment' | 'other';
  due_date: string | null;
  status: 'open' | 'in_progress' | 'done' | 'overdue';
  owner: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

```

---

## `src/lib/dates.ts`

```ts
export function daysSince(sqliteDateTime: string | null | undefined): number | null {
  if (!sqliteDateTime) return null;
  const iso = sqliteDateTime.includes('T') ? sqliteDateTime : `${sqliteDateTime.replace(' ', 'T')}Z`;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function daysUntil(sqliteDate: string | null | undefined): number | null {
  if (!sqliteDate) return null;
  const iso = sqliteDate.includes('T') ? sqliteDate : `${sqliteDate}T00:00:00Z`;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

```

---

## `src/db/db.ts`

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.HELM_DB_PATH ?? './data/helm.db';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate(): void {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
}

migrate();

```

---

## `src/db/schema.sql`

```sql
-- Helm's own datastore. This is Helm's working memory, not the system of
-- record for Canopy/Ronin/Gavin (which today live in a single client-side
-- HTML app with localStorage/JSONBin storage — see docs/ARCHITECTURE.md for
-- why Helm doesn't read that data directly yet, and what the integration
-- seam looks like when it does).

CREATE TABLE IF NOT EXISTS clients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  tier           TEXT NOT NULL DEFAULT 'standard', -- standard | priority | pilot
  status         TEXT NOT NULL DEFAULT 'prospect',  -- prospect | pilot | active | churned
  contract_terms TEXT,                              -- free text summary; escalate on any change
  site_count     INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | sent | accepted | declined | expired
  amount_cents    INTEGER NOT NULL,
  cost_of_sale_cents INTEGER NOT NULL DEFAULT 0,
  pricing_band_min_cents INTEGER,
  pricing_band_max_cents INTEGER,
  requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  followed_up_at  TEXT,
  sent_at         TEXT,
  decided_at      TEXT,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  amount_cents INTEGER NOT NULL,
  due_date     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | reminded | paid | overdue | write_off_candidate
  last_reminded_at TEXT,
  reminder_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT,
  source      TEXT,             -- e.g. web_search, referral, supplied list
  status      TEXT NOT NULL DEFAULT 'new', -- new | contacted | replied | lost
  notes       TEXT,
  found_at    TEXT NOT NULL DEFAULT (datetime('now')),
  contacted_at TEXT
);

CREATE TABLE IF NOT EXISTS compliance_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL, -- company_law | contracts | dpa_privacy | ip_assignment | other
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | in_progress | done | overdue
  owner       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The escalation/audit log: every action the agent takes or proposes lands
-- here, whether it executed automatically or is waiting on a human.
CREATE TABLE IF NOT EXISTS actions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  domain         TEXT NOT NULL,   -- sales | finance | governance | ops
  action_type    TEXT NOT NULL,   -- e.g. send_invoice_reminder, adjust_quote_price
  summary        TEXT NOT NULL,
  recommendation TEXT,            -- agent's reasoning / suggested next step
  payload_json   TEXT NOT NULL DEFAULT '{}',
  risk           TEXT NOT NULL,   -- auto | escalate
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | auto_executed | approved | declined | edited | timed_out
  resolution_note TEXT,
  -- Only ever set for sales discounts above the auto-approve band (see
  -- gate.ts) — Josh's rule is that those carry a 4-day countdown and
  -- execute automatically if not declined, unlike every other escalation
  -- (governance/finance/contracts/spend/hiring), which has no timer and
  -- only proceeds on explicit approval.
  auto_execute_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance_items(status);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_actions_auto_execute_at ON actions(auto_execute_at);

```

---

## `src/db/seed.ts`

```ts
import 'dotenv/config';
import { db } from './db.js';

// Minimal seed data so Helm has something real to reason about in dev/demo.
// Perpetual Pantries currently has one verbal-agreement pilot client and no
// live POS/billing feed — this seed reflects that, it doesn't invent scale
// that doesn't exist yet. Swap for real data via the Canopy/Xero/Lightspeed
// adapters described in docs/ARCHITECTURE.md once those feeds exist.

const clientCount = db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number };

if (clientCount.n === 0) {
  const insertClient = db.prepare(
    `INSERT INTO clients (name, tier, status, contract_terms, site_count) VALUES (?, ?, ?, ?, ?)`
  );
  const pilot = insertClient.run('First Pilot Client', 'pilot', 'pilot', 'Verbal agreement — no signed contract yet', 1);

  const insertQuote = db.prepare(
    `INSERT INTO quotes (client_id, status, amount_cents, cost_of_sale_cents, pricing_band_min_cents, pricing_band_max_cents, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-10 days'))`
  );
  insertQuote.run(pilot.lastInsertRowid, 'pending', 250000, 150000, 200000, 300000);

  const insertCompliance = db.prepare(
    `INSERT INTO compliance_items (title, category, due_date, status, owner, notes)
     VALUES (?, ?, date('now', ?), ?, ?, ?)`
  );
  insertCompliance.run(
    'Get pilot client agreement in writing',
    'contracts',
    '+5 days',
    'open',
    'founder',
    'Currently verbal only — highest-priority governance gap.'
  );
  insertCompliance.run(
    'Confirm DPA / ZDR terms with Anthropic for any customer data touched by Gavin',
    'dpa_privacy',
    '+21 days',
    'open',
    'founder',
    null
  );
  insertCompliance.run(
    'Set up IP assignment agreement template for contractors/developers',
    'ip_assignment',
    '+30 days',
    'open',
    'founder',
    null
  );

  const insertLead = db.prepare(
    `INSERT INTO leads (name, company, email, source, status) VALUES (?, ?, ?, ?, ?)`
  );
  insertLead.run('Sam Lee', 'Sunrise Aged Care', 'sam@sunriseaged.example', 'referral', 'new');

  console.log(`Seeded 1 client, 1 quote, 3 compliance items, 1 lead.`);
} else {
  console.log('Database already has data — skipping seed.');
}

```

---

## `src/domains/sales.ts`

```ts
import { db } from '../db/db.js';
import { daysSince } from '../lib/dates.js';
import type { LeadRow, QuoteRow } from '../types.js';

const STALE_AFTER_DAYS = 5;

export function buildSnapshot() {
  const pending = db
    .prepare(
      `SELECT q.*, c.name AS client_name, c.tier AS client_tier
       FROM quotes q JOIN clients c ON c.id = q.client_id
       WHERE q.status = 'pending'`
    )
    .all() as (QuoteRow & { client_name: string; client_tier: string })[];

  const openLeads = db.prepare(`SELECT * FROM leads WHERE status IN ('new','contacted')`).all() as LeadRow[];

  return {
    pending_quotes: pending.map((q) => ({
      id: q.id,
      client: q.client_name,
      tier: q.client_tier,
      amount_cents: q.amount_cents,
      pricing_band_min_cents: q.pricing_band_min_cents,
      pricing_band_max_cents: q.pricing_band_max_cents,
      requested_at: q.requested_at,
      days_since_last_contact: daysSince(q.followed_up_at ?? q.requested_at),
      stale: (daysSince(q.followed_up_at ?? q.requested_at) ?? 0) >= STALE_AFTER_DAYS,
    })),
    open_leads: openLeads.map((l) => ({
      id: l.id,
      name: l.name,
      company: l.company,
      status: l.status,
      days_since_found: daysSince(l.found_at),
    })),
  };
}

// Real send-a-message integration isn't wired up yet (no Gmail/SMTP adapter),
// so "sending" a follow-up today means drafting it and logging it — see
// src/integrations/notify.ts for the seam where that becomes a real send.
export function execute(actionType: string, payload: Record<string, unknown>): string {
  switch (actionType) {
    case 'send_quote_followup': {
      const id = Number(payload.quote_id);
      db.prepare(`UPDATE quotes SET followed_up_at = datetime('now') WHERE id = ?`).run(id);
      return `Follow-up drafted and logged for quote #${id}. Outbound send is stubbed — wire src/integrations/notify.ts to actually deliver it.`;
    }
    case 'adjust_quote_price': {
      const id = Number(payload.quote_id);
      const newAmount = Number(payload.new_amount_cents);
      if (!Number.isFinite(id) || !Number.isFinite(newAmount)) {
        return `Could not adjust price — missing quote_id or new_amount_cents.`;
      }
      db.prepare(`UPDATE quotes SET amount_cents = ? WHERE id = ?`).run(newAmount, id);
      return `Quote #${id} price updated to ${newAmount} cents.`;
    }
    // Discounts <=5% off list are auto-approved by the gate; discounts above
    // that land here only after approval (either immediate, for editorial
    // clarity, or after the 4-day auto-execute window — see execute.ts and
    // scheduler/index.ts). Either way, by the time this runs the decision
    // has already been made; this just applies it.
    case 'propose_sales_discount': {
      const quoteId = Number(payload.quote_id);
      const pct = Number(payload.discount_percent);
      if (Number.isFinite(quoteId) && Number.isFinite(pct)) {
        db.prepare(`UPDATE quotes SET amount_cents = CAST(amount_cents * (1 - ?/100.0) AS INTEGER) WHERE id = ?`).run(
          pct,
          quoteId
        );
        return `Applied a ${pct}% discount to quote #${quoteId}.`;
      }
      return `Discount of ${Number.isFinite(pct) ? pct : '?'}% logged for ${payload.client ?? 'client'} (no quote_id given, so no quote was updated — record this against the deal manually).`;
    }
    case 'log_lead': {
      db.prepare(
        `INSERT INTO leads (name, company, email, source, notes) VALUES (?, ?, ?, ?, ?)`
      ).run(
        String(payload.name ?? 'Unnamed lead'),
        (payload.company as string) ?? null,
        (payload.email as string) ?? null,
        (payload.source as string) ?? 'agent',
        (payload.notes as string) ?? null
      );
      return `Lead logged: ${payload.name ?? 'unnamed'}.`;
    }
    case 'mark_lead_contacted': {
      const id = Number(payload.lead_id);
      if (Number.isFinite(id)) {
        db.prepare(`UPDATE leads SET status = 'contacted', contacted_at = datetime('now') WHERE id = ?`).run(id);
      }
      return `Outreach drafted and lead marked contacted${Number.isFinite(id) ? ` (#${id})` : ''}. Outbound send is stubbed — see src/integrations/notify.ts; a real Gmail draft/send integration is the natural next step here.`;
    }
    default:
      return `No auto-executor for "${actionType}" yet — logged for visibility only.`;
  }
}

```

---

## `src/domains/finance.ts`

```ts
import { db } from '../db/db.js';
import { daysUntil } from '../lib/dates.js';
import type { InvoiceRow, QuoteRow } from '../types.js';

export function buildSnapshot() {
  const invoices = db
    .prepare(
      `SELECT i.*, c.name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.status IN ('pending','reminded','overdue')`
    )
    .all() as (InvoiceRow & { client_name: string })[];

  const acceptedQuotes = db
    .prepare(
      `SELECT q.*, c.name AS client_name, c.tier AS client_tier
       FROM quotes q JOIN clients c ON c.id = q.client_id
       WHERE q.status = 'accepted'`
    )
    .all() as (QuoteRow & { client_name: string; client_tier: string })[];

  return {
    open_invoices: invoices.map((i) => {
      const overdueBy = -(daysUntil(i.due_date) ?? 0);
      return {
        id: i.id,
        client: i.client_name,
        amount_cents: i.amount_cents,
        due_date: i.due_date,
        days_overdue: Math.max(0, overdueBy),
        reminder_count: i.reminder_count,
        status: i.status,
      };
    }),
    margin_by_accepted_quote: acceptedQuotes.map((q) => ({
      client: q.client_name,
      tier: q.client_tier,
      revenue_cents: q.amount_cents,
      cost_of_sale_cents: q.cost_of_sale_cents,
      margin_pct:
        q.amount_cents > 0
          ? Math.round(((q.amount_cents - q.cost_of_sale_cents) / q.amount_cents) * 1000) / 10
          : null,
    })),
    note:
      acceptedQuotes.length === 0
        ? 'No accepted quotes / live revenue yet. Profitability analysis is scaffolded but has nothing real to optimize against until POS/billing data flows — do not invent numbers.'
        : undefined,
  };
}

export function execute(actionType: string, payload: Record<string, unknown>): string {
  switch (actionType) {
    case 'send_invoice_reminder': {
      const id = Number(payload.invoice_id);
      if (!Number.isFinite(id)) return `Could not send reminder — missing invoice_id.`;
      db.prepare(
        `UPDATE invoices SET status = 'reminded', last_reminded_at = datetime('now'), reminder_count = reminder_count + 1 WHERE id = ?`
      ).run(id);
      return `Reminder drafted and logged for invoice #${id}. Outbound send is stubbed — wire src/integrations/notify.ts to actually deliver it.`;
    }
    case 'flag_margin_issue':
      return `Margin flag logged for visibility.`;
    default:
      return `No auto-executor for "${actionType}" yet — logged for visibility only.`;
  }
}

```

---

## `src/domains/governance.ts`

```ts
import { db } from '../db/db.js';
import { daysUntil } from '../lib/dates.js';
import type { ComplianceRow } from '../types.js';

export function buildSnapshot() {
  const items = db.prepare(`SELECT * FROM compliance_items WHERE status != 'done'`).all() as ComplianceRow[];

  return {
    open_items: items.map((i) => ({
      id: i.id,
      title: i.title,
      category: i.category,
      due_date: i.due_date,
      days_until_due: daysUntil(i.due_date),
      status: i.status,
      owner: i.owner,
    })),
    note: 'This is company-level governance (contracts, IP assignment, DPA/privacy, ASIC/company-law housekeeping) — not the café-facing OHS/temp-log compliance Gavin already handles per site.',
  };
}

export function execute(actionType: string, payload: Record<string, unknown>): string {
  switch (actionType) {
    case 'flag_deadline_risk': {
      const id = Number(payload.compliance_item_id);
      if (Number.isFinite(id)) {
        db.prepare(
          `UPDATE compliance_items SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'open'`
        ).run(id);
      }
      return `Deadline risk flagged${Number.isFinite(id) ? ` for compliance item #${id}` : ''}.`;
    }
    case 'ip_assignment_reminder':
      return `IP assignment reminder logged.`;
    default:
      return `No auto-executor for "${actionType}" yet — logged for visibility only.`;
  }
}

```

---

## `src/domains/ops.ts`

```ts
// Team/schedule/ordering are owned by Canopy today. Helm has read/oversight
// intent here but no write access to Canopy's data yet (Canopy is a
// client-side app with its own localStorage/JSONBin storage — see
// docs/ARCHITECTURE.md). Until that integration exists, ops actions are
// always logged/flagged, never actuated.

export function buildSnapshot() {
  return {
    open_items: [],
    note: 'Ops oversight is scaffolded but not yet wired to Canopy\'s team/schedule/ordering data. Nothing to review until that read integration exists.',
  };
}

export function execute(actionType: string, _payload: Record<string, unknown>): string {
  return `No auto-executor for "${actionType}" — ops actions are always logged/flagged only, never actuated directly by Helm.`;
}

```

---

## `src/agent/tools.ts`

```ts
import type Anthropic from '@anthropic-ai/sdk';

export const proposeActionTool: Anthropic.Tool = {
  name: 'propose_action',
  description:
    'Propose a single concrete action for Helm to take or queue for approval. Call it once per action — call it multiple times in the same turn if several actions are warranted. Do not call it just to restate the snapshot; only for things with a real effect.',
  input_schema: {
    type: 'object',
    properties: {
      action_type: {
        type: 'string',
        description:
          "Machine-readable action type, e.g. 'send_invoice_reminder', 'adjust_quote_price', 'flag_deadline_risk', 'flag_margin_issue', 'ip_assignment_reminder'. Use an existing type when one fits; invent a new snake_case one only when nothing fits (new types always require human approval, so don't invent one to dodge that).",
      },
      summary: {
        type: 'string',
        description: 'One-sentence human-readable summary of the action, referencing the specific record (client/quote/invoice/item) by name or ID.',
      },
      recommendation: {
        type: 'string',
        description: 'Why this action, in a sentence or two — what you saw in the snapshot, and what you recommend if a human ends up approving it.',
      },
      payload: {
        type: 'object',
        description:
          'Structured data needed to actually execute the action, e.g. { "quote_id": 4, "new_amount_cents": 275000, "pricing_band_min_cents": 200000, "pricing_band_max_cents": 300000 } or { "invoice_id": 9, "days_overdue": 12, "reminder_count": 0 }. Include whatever fields the classifier would need to tell routine from not — e.g. always include the band and the invoice\'s current overdue days / reminder count when relevant.',
      },
    },
    required: ['action_type', 'summary'],
  },
};

```

---

## `src/agent/gate.ts`

```ts
import type { Domain, Risk } from '../types.js';

type Classifier = (payload: Record<string, unknown>) => Risk;

// Deterministic, code-enforced classification. The model proposes actions;
// it never gets to decide for itself whether something is routine — that
// stays in code so the authority boundary can't drift from a prompt change
// or a persuasive-sounding model turn.
// Discounts of 5% or less off list are routine and auto-approve on the
// spot. Above that, they escalate — but with a 4-day auto-execute timer
// (see recordAction in execute.ts), unlike every other escalation, which
// only proceeds on explicit approval. This threshold is Josh's own rule
// from the original Helm design (docs/ARCHITECTURE.md), not something we
// invented — keep it in sync with that doc if it ever changes.
export const SALES_DISCOUNT_AUTO_APPROVE_MAX_PCT = 5;

const rules: Record<string, Classifier> = {
  'sales:send_quote_followup': () => 'auto',
  'sales:log_lead': () => 'auto',
  'sales:mark_lead_contacted': () => 'auto',
  'sales:adjust_quote_price': (payload) => {
    const min = Number(payload.pricing_band_min_cents);
    const max = Number(payload.pricing_band_max_cents);
    const amount = Number(payload.new_amount_cents);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(amount)) return 'escalate';
    return amount >= min && amount <= max ? 'auto' : 'escalate';
  },
  'sales:propose_sales_discount': (payload) => {
    const pct = Number(payload.discount_percent);
    if (!Number.isFinite(pct)) return 'escalate';
    return pct <= SALES_DISCOUNT_AUTO_APPROVE_MAX_PCT ? 'auto' : 'escalate';
  },
  'finance:send_invoice_reminder': (payload) => {
    const daysOverdue = Number(payload.days_overdue ?? 0);
    const reminderCount = Number(payload.reminder_count ?? 0);
    return daysOverdue < 60 && reminderCount < 2 ? 'auto' : 'escalate';
  },
  'finance:flag_margin_issue': () => 'auto',
  'governance:flag_deadline_risk': () => 'auto',
  'governance:ip_assignment_reminder': () => 'auto',
};

// These always escalate regardless of domain or what the model calls them —
// contract terms, hiring/spend commitments, and legal language are exactly
// the "big decisions" the human asked to stay in the loop on.
const alwaysEscalate = [/contract/i, /hir(e|ing)/i, /\bspend\b/i, /legal/i, /write.?off/i, /pricing_change/i];

export function classify(domain: Domain, actionType: string, payload: Record<string, unknown>): Risk {
  if (alwaysEscalate.some((re) => re.test(actionType))) return 'escalate';
  const rule = rules[`${domain}:${actionType}`];
  // Unknown action types default to escalate, never auto — a new action
  // type is by definition something Helm has no track record on yet.
  if (!rule) return 'escalate';
  return rule(payload);
}

```

---

## `src/agent/prompts.ts`

```ts
import type { Domain } from '../types.js';

const shared = `You are Helm, the company-wide agent for Perpetual Pantries (PP). You sit above Canopy (client ops), Ronin (per-org assistant), and Gavin (per-café assistant) — your job is cross-functional: keep the business governed, compliant, growing, and as profitable as it can honestly be.

You do not decide what counts as routine versus what needs a human. That boundary is enforced by code after you propose an action, using fixed rules (pricing bands, overdue-day cutoffs, and an always-escalate list for contracts, hiring, spend, and legal language). So propose whatever you think is actually the right call — don't self-censor to "sound safe," and don't inflate something routine into a big ask either. Be concrete: reference specific IDs and names from the snapshot you're given, never generalities.

Only call propose_action for things with a real effect (sending a reminder, adjusting a price, flagging a deadline, logging a margin concern). Don't call it to restate the snapshot back, and don't fabricate data that isn't in the snapshot — if there's genuinely nothing to act on, say so in plain text and call no tools.`;

const byDomain: Record<Domain, string> = {
  sales: `${shared}

Domain: Sales & growth. Focus on moving pending quotes forward — following up on stale requests, tracking and following up on leads, and handling discounts. Discount rule specifically: propose_sales_discount at 5% off list or less will auto-approve immediately (act like it already happened); above 5% it escalates to Josh with a 4-day auto-execute timer — it goes through on its own if he doesn't decline it in that window, so don't hedge on making the recommendation. Always include discount_percent in the payload so the code-side gate can classify it correctly. Log leads you're tracking with log_lead, and mark_lead_contacted once outreach is drafted.`,
  finance: `${shared}

Domain: Finance & profitability. Focus on collecting what's owed and spotting margin problems on quotes that have actually converted. PP has very little live revenue data right now — if the snapshot says so, don't invent numbers or manufacture urgency; propose nothing rather than guess.`,
  governance: `${shared}

Domain: Governance & compliance. Focus on contract/legal housekeeping, IP assignment, privacy/DPA obligations, and deadlines. This is company-level governance — not the café-facing OHS/temp-log compliance Gavin already owns per site.`,
  ops: `${shared}

Domain: Ops oversight. Team/schedule/ordering are owned by Canopy — you have visibility intent only, not write access, and today not even a real read feed. Flag issues for a human; never claim to have changed anything in ops directly.`,
};

export function systemPromptFor(domain: Domain): string {
  return byDomain[domain];
}

```

---

## `src/agent/execute.ts`

```ts
import { db } from '../db/db.js';
import type { ActionRow, Domain, Risk } from '../types.js';
import * as sales from '../domains/sales.js';
import * as finance from '../domains/finance.js';
import * as governance from '../domains/governance.js';
import * as ops from '../domains/ops.js';

const domainModules: Record<Domain, { execute(actionType: string, payload: Record<string, unknown>): string }> = {
  sales,
  finance,
  governance,
  ops,
};

export interface ProposedInput {
  action_type: string;
  summary: string;
  recommendation?: string;
  payload?: Record<string, unknown>;
}

// Only sales discounts above the auto-approve band carry a countdown —
// every other escalation (governance, finance, contracts, spend, hiring)
// has no timer and only proceeds on explicit approval. Keep this set in
// sync with gate.ts's SALES_DISCOUNT_AUTO_APPROVE_MAX_PCT rule.
const TIMED_ESCALATIONS = new Set(['sales:propose_sales_discount']);
const AUTO_EXECUTE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

export function recordAction(domain: Domain, input: ProposedInput, risk: Risk): number {
  const status = risk === 'auto' ? 'auto_executed' : 'pending';
  const isTimed = risk === 'escalate' && TIMED_ESCALATIONS.has(`${domain}:${input.action_type}`);
  const autoExecuteAt = isTimed ? new Date(Date.now() + AUTO_EXECUTE_WINDOW_MS).toISOString() : null;

  const result = db
    .prepare(
      `INSERT INTO actions (domain, action_type, summary, recommendation, payload_json, risk, status, auto_execute_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      domain,
      input.action_type,
      input.summary,
      input.recommendation ?? null,
      JSON.stringify(input.payload ?? {}),
      risk,
      status,
      autoExecuteAt,
      risk === 'auto' ? new Date().toISOString() : null
    );
  return Number(result.lastInsertRowid);
}

// Runs on a schedule (see scheduler/index.ts). Anything past its timer and
// still pending executes exactly as if Josh had approved it — the timer
// itself is the approval mechanism for this one class of action.
export function runAutoExecuteSweep(): ActionRow[] {
  const due = db
    .prepare(`SELECT * FROM actions WHERE status = 'pending' AND auto_execute_at IS NOT NULL AND auto_execute_at <= datetime('now')`)
    .all() as ActionRow[];

  return due.map((action) => {
    const payload = JSON.parse(action.payload_json) as Record<string, unknown>;
    const execNote = domainModules[action.domain].execute(action.action_type, payload);
    db.prepare(
      `UPDATE actions SET status = 'approved', resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(`Auto-executed after 4-day window (not declined) — ${execNote}`, action.id);
    return db.prepare(`SELECT * FROM actions WHERE id = ?`).get(action.id) as ActionRow;
  });
}

export function autoExecute(domain: Domain, actionId: number, actionType: string, payload: Record<string, unknown>): void {
  const note = domainModules[domain].execute(actionType, payload);
  db.prepare(`UPDATE actions SET resolution_note = ? WHERE id = ?`).run(note, actionId);
}

export function resolveAction(
  id: number,
  decision: 'approve' | 'decline' | 'edit',
  note?: string,
  editedPayload?: Record<string, unknown>
): ActionRow {
  const action = db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as ActionRow | undefined;
  if (!action) throw new Error(`Action #${id} not found.`);
  if (action.status !== 'pending') {
    throw new Error(`Action #${id} was already resolved (status: ${action.status}).`);
  }

  if (decision === 'decline') {
    db.prepare(`UPDATE actions SET status = 'declined', resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`).run(
      note ?? null,
      id
    );
  } else {
    const payload = editedPayload ?? (JSON.parse(action.payload_json) as Record<string, unknown>);
    const execNote = domainModules[action.domain].execute(action.action_type, payload);
    const status = decision === 'edit' ? 'edited' : 'approved';
    const resolutionNote = [note, execNote].filter(Boolean).join(' — ');
    db.prepare(`UPDATE actions SET status = ?, payload_json = ?, resolution_note = ?, resolved_at = datetime('now') WHERE id = ?`).run(
      status,
      JSON.stringify(payload),
      resolutionNote,
      id
    );
  }

  return db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as ActionRow;
}

```

---

## `src/agent/loop.ts`

```ts
import Anthropic from '@anthropic-ai/sdk';
import { proposeActionTool } from './tools.js';
import { classify } from './gate.js';
import { recordAction, autoExecute, type ProposedInput } from './execute.js';
import type { Domain } from '../types.js';

const MODEL = process.env.HELM_MODEL ?? 'claude-sonnet-5';
const MAX_TURNS = 4;

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set — cannot run the agent loop.');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface ReviewResult {
  proposed: number;
  auto: number;
  escalated: number;
  final_note?: string;
}

export async function reviewDomain(domain: Domain, snapshot: unknown, systemPrompt: string): Promise<ReviewResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Current ${domain} snapshot:\n\n${JSON.stringify(snapshot, null, 2)}\n\nReview this. Call propose_action for every action worth taking right now. If nothing needs action, just say so briefly and call no tools.`,
    },
  ];

  const result: ReviewResult = { proposed: 0, auto: 0, escalated: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools: [proposeActionTool],
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUses.length === 0) {
      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      result.final_note = text?.text;
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = use.input as ProposedInput;
      const risk = classify(domain, input.action_type, input.payload ?? {});
      const actionId = recordAction(domain, input, risk);
      result.proposed++;

      if (risk === 'auto') {
        autoExecute(domain, actionId, input.action_type, input.payload ?? {});
        result.auto++;
      } else {
        result.escalated++;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: `Logged as action #${actionId} (risk=${risk}, ${risk === 'auto' ? 'executed immediately' : 'queued for human approval'}).`,
      });
    }
    messages.push({ role: 'user', content: toolResults });

    if (response.stop_reason !== 'tool_use') break;
  }

  return result;
}

```

---

## `src/agent/review.ts`

```ts
import type { Domain } from '../types.js';
import { reviewDomain, type ReviewResult } from './loop.js';
import { systemPromptFor } from './prompts.js';
import * as sales from '../domains/sales.js';
import * as finance from '../domains/finance.js';
import * as governance from '../domains/governance.js';
import * as ops from '../domains/ops.js';

const snapshotBuilders: Record<Domain, () => unknown> = {
  sales: sales.buildSnapshot,
  finance: finance.buildSnapshot,
  governance: governance.buildSnapshot,
  ops: ops.buildSnapshot,
};

const ALL_DOMAINS: Domain[] = ['sales', 'finance', 'governance', 'ops'];

export async function runFullReview(): Promise<Record<Domain, ReviewResult>> {
  const summary = {} as Record<Domain, ReviewResult>;
  for (const domain of ALL_DOMAINS) {
    const snapshot = snapshotBuilders[domain]();
    summary[domain] = await reviewDomain(domain, snapshot, systemPromptFor(domain));
  }
  return summary;
}

```

---

## `src/api/auth.ts`

```ts
import type { NextFunction, Request, Response } from 'express';

export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.HELM_ADMIN_TOKEN;
  if (!expected || expected === 'change-me') {
    res.status(500).json({ error: 'HELM_ADMIN_TOKEN is not configured on the server — refusing to authorize anything.' });
    return;
  }
  const provided = req.header('x-helm-token');
  if (provided !== expected) {
    res.status(401).json({ error: 'Missing or invalid x-helm-token header.' });
    return;
  }
  next();
}

```

---

## `src/api/routes.ts`

```ts
import { Router } from 'express';
import { db } from '../db/db.js';
import { requireAdminToken } from './auth.js';
import { resolveAction } from '../agent/execute.js';
import { runFullReview } from '../agent/review.js';
import type { ActionRow, ClientRow, ComplianceRow, InvoiceRow, LeadRow, QuoteRow } from '../types.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.get('/actions', (req, res) => {
  const { status, domain } = req.query;
  let query = 'SELECT * FROM actions WHERE 1=1';
  const params: unknown[] = [];
  if (typeof status === 'string') {
    query += ' AND status = ?';
    params.push(status);
  }
  if (typeof domain === 'string') {
    query += ' AND domain = ?';
    params.push(domain);
  }
  query += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(query).all(...params) as ActionRow[]);
});

router.get('/actions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id) as ActionRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(row);
});

router.post('/actions/:id/approve', requireAdminToken, (req, res) => {
  try {
    res.json(resolveAction(Number(req.params.id), 'approve', req.body?.note));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/actions/:id/decline', requireAdminToken, (req, res) => {
  try {
    res.json(resolveAction(Number(req.params.id), 'decline', req.body?.note));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/actions/:id/edit', requireAdminToken, (req, res) => {
  try {
    res.json(resolveAction(Number(req.params.id), 'edit', req.body?.note, req.body?.payload));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/review', requireAdminToken, async (_req, res) => {
  try {
    res.json(await runFullReview());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/clients', (_req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY id').all() as ClientRow[]);
});

router.get('/quotes', (_req, res) => {
  res.json(db.prepare('SELECT * FROM quotes ORDER BY id').all() as QuoteRow[]);
});

router.get('/invoices', (_req, res) => {
  res.json(db.prepare('SELECT * FROM invoices ORDER BY id').all() as InvoiceRow[]);
});

router.get('/compliance', (_req, res) => {
  res.json(db.prepare('SELECT * FROM compliance_items ORDER BY id').all() as ComplianceRow[]);
});

router.get('/leads', (_req, res) => {
  res.json(db.prepare('SELECT * FROM leads ORDER BY id').all() as LeadRow[]);
});

```

---

## `src/scheduler/index.ts`

```ts
import cron from 'node-cron';
import { runFullReview } from '../agent/review.js';
import { runAutoExecuteSweep } from '../agent/execute.js';

// Timed sales-discount escalations (see execute.ts) need checking often
// enough that a 4-day window doesn't slip by much — every 15 minutes is
// plenty granular for that and cheap since it's a single indexed query.
const AUTO_EXECUTE_SWEEP_CRON = '*/15 * * * *';

// Requires ANTHROPIC_API_KEY (it calls Claude). Gated by the caller.
export function startReviewScheduler(): void {
  const schedule = process.env.HELM_REVIEW_CRON ?? '*/30 * * * *';
  if (!cron.validate(schedule)) {
    console.error(`[scheduler] Invalid HELM_REVIEW_CRON "${schedule}" — scheduler not started.`);
    return;
  }

  cron.schedule(schedule, () => {
    console.log('[scheduler] running full domain review...');
    runFullReview()
      .then((summary) => console.log('[scheduler] review complete:', JSON.stringify(summary)))
      .catch((err) => console.error('[scheduler] review failed:', err));
  });
  console.log(`[scheduler] domain review scheduled: "${schedule}"`);
}

// Pure DB logic, no model call — runs regardless of whether
// ANTHROPIC_API_KEY is set, since it only executes decisions already made
// (a timer expiring on a sales discount nobody declined), not new ones.
export function startAutoExecuteSweep(): void {
  cron.schedule(AUTO_EXECUTE_SWEEP_CRON, () => {
    try {
      const executed = runAutoExecuteSweep();
      if (executed.length > 0) {
        console.log(`[scheduler] auto-executed ${executed.length} timed-out sales discount(s):`, executed.map((a) => a.id));
      }
    } catch (err) {
      console.error('[scheduler] auto-execute sweep failed:', err);
    }
  });
  console.log(`[scheduler] timed-escalation sweep scheduled: "${AUTO_EXECUTE_SWEEP_CRON}"`);
}

```

---

## `src/integrations/notify.ts`

```ts
// Outbound-communication seam. Nothing here actually sends anything yet —
// domain modules call this (or will, once wired in) instead of hard-coding
// a send path, so plugging in real email/SMS later is a one-file change.
//
// TODO: wire to Gmail (the Gmail MCP tools already available to Claude Code
// sessions on this account) or a transactional-email provider once PP wants
// Helm's routine follow-ups/reminders to actually go out unattended.

export interface DraftMessage {
  to: string;
  subject: string;
  body: string;
}

export function draft(message: DraftMessage): DraftMessage {
  console.log(`[notify:stub] Would send to ${message.to}: ${message.subject}`);
  return message;
}

```

---
