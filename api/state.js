import { requireAuth } from './_lib/auth.js';
import { loadState, saveState } from './_lib/db.js';

export default async function handler(req, res){
  if(!requireAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  try{
    if(req.method === 'GET'){
      const { value, version } = await loadState();
      return res.status(200).json({ state: value, version });
    }
    if(req.method === 'PUT'){
      const { state, version } = req.body || {};
      if(!state || typeof state !== 'object' || !Number.isInteger(version)){
        return res.status(400).json({ error: 'Body must be { state: object, version: integer }.' });
      }
      const newVersion = await saveState(state, version);
      if(newVersion === null){
        // Another device saved first — hand back what's stored so the client can adopt it.
        const current = await loadState();
        return res.status(409).json({ error: 'Version conflict', state: current.value, version: current.version });
      }
      return res.status(200).json({ version: newVersion });
    }
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }catch(err){
    console.error('State request failed', err);
    return res.status(500).json({ error: err.message || 'State request failed' });
  }
}
