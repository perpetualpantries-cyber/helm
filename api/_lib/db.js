import { neon } from '@neondatabase/serverless';

export const STATE_KEY = 'helm-state';

let sql;
let ready;

function db(){
  if(!sql){
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured on the server.');
    sql = neon(process.env.DATABASE_URL);
  }
  if(!ready){
    ready = sql`CREATE TABLE IF NOT EXISTS helm_state (
      key        text PRIMARY KEY,
      value      jsonb NOT NULL,
      version    integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.catch(e => { ready = null; throw e; });
  }
  return ready.then(() => sql);
}

// Returns { value, version } — version 0 means nothing has been saved yet.
export async function loadState(key = STATE_KEY){
  const q = await db();
  const rows = await q`SELECT value, version FROM helm_state WHERE key = ${key}`;
  return rows.length ? { value: rows[0].value, version: rows[0].version } : { value: null, version: 0 };
}

// Optimistic concurrency: only writes when the stored version still matches
// baseVersion. Returns the new version, or null if another device saved first.
export async function saveState(value, baseVersion, key = STATE_KEY){
  const q = await db();
  const rows = await q`
    INSERT INTO helm_state (key, value, version, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, 1, now())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, version = helm_state.version + 1, updated_at = now()
      WHERE helm_state.version = ${baseVersion}
    RETURNING version`;
  return rows.length ? rows[0].version : null;
}
