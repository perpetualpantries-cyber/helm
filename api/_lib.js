import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

let client;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  client ??= neon(process.env.DATABASE_URL);
  return client;
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Helm runs in the browser, so read endpoints need CORS.
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CANOPY_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
