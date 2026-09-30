import { loadState, saveState } from '../_lib/db.js';

// Server-side twin of checkAutoExecutions() in index.html, so timed sales
// escalations still execute when no device has Helm open. Vercel Cron calls
// this with "Authorization: Bearer $CRON_SECRET".
export default async function handler(req, res){
  const secret = process.env.CRON_SECRET;
  if(!secret || req.headers.authorization !== `Bearer ${secret}`){
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try{
    for(let attempt = 0; attempt < 3; attempt++){
      const { value: state, version } = await loadState();
      if(!state) return res.status(200).json({ executed: 0 });
      const now = Date.now();
      let executed = 0;
      (state.escalations || []).forEach(e => {
        if(e.status === 'pending' && e.autoExecuteAt && now >= e.autoExecuteAt){
          e.status = 'approved';
          e.resolvedAt = now;
          e.autoExecuted = true;
          state.auditLog = state.auditLog || [];
          state.auditLog.unshift({ id: Math.random().toString(36).slice(2, 10), ts: now, action: `Auto-executed after 4-day window (not declined): ${e.title}`, domain: e.domain, autoActed: true });
          executed++;
        }
      });
      if(!executed) return res.status(200).json({ executed: 0 });
      state.auditLog = state.auditLog.slice(0, 200);
      if(await saveState(state, version) !== null) return res.status(200).json({ executed });
    }
    return res.status(409).json({ error: 'State kept changing; will retry next run.' });
  }catch(err){
    console.error('Auto-execute failed', err);
    return res.status(500).json({ error: err.message });
  }
}
