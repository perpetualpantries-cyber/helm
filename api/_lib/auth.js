import { createHash, timingSafeEqual } from 'node:crypto';

const digest = s => createHash('sha256').update(String(s)).digest();

// Shared-password gate. Fails closed when HELM_PASSWORD isn't configured.
export function requireAuth(req, res){
  const expected = process.env.HELM_PASSWORD;
  if(!expected){
    res.status(500).json({ error: 'HELM_PASSWORD is not configured on the server.' });
    return false;
  }
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if(!given || !timingSafeEqual(digest(given), digest(expected))){
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
