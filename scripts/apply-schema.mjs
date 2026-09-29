// Usage: DATABASE_URL=... npm run db:schema
import { readFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(schema);
  console.log('Schema applied.');
} finally {
  await pool.end();
}
