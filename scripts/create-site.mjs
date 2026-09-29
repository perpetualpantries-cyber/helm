// Registers a café and prints its ingest token (shown once — only the hash is stored).
// Usage: DATABASE_URL=... npm run site:create -- "Client name" "Site name" [timezone]
// Reuses the client if one with that exact name already exists.
import { randomBytes, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const [clientName, siteName, timezone = 'Australia/Sydney'] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !clientName || !siteName) {
  console.error('Usage: DATABASE_URL=... npm run site:create -- "Client name" "Site name" [timezone]');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

let [client] = await sql`SELECT id FROM clients WHERE name = ${clientName} LIMIT 1`;
if (!client) {
  [client] = await sql`INSERT INTO clients (name) VALUES (${clientName}) RETURNING id`;
}

const token = 'pps_' + randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const [site] = await sql`
  INSERT INTO sites (client_id, name, timezone, ingest_token_hash)
  VALUES (${client.id}, ${siteName}, ${timezone}, ${hash})
  RETURNING id`;

console.log(`Client: ${clientName} (${client.id})`);
console.log(`Site:   ${siteName} (${site.id})`);
console.log(`Ingest token (store it in the PP app; it cannot be shown again):\n  ${token}`);
