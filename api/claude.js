import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from './_lib/auth.js';
import { HELM_SYSTEM_PROMPT, HELM_TOOLS } from './_lib/helm.js';
import { getGmailAccessToken } from './_lib/google.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const MODEL = process.env.HELM_MODEL || 'claude-sonnet-4-6';
const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';

const NO_GMAIL_NOTE = `

Gmail is not connected in this deployment, so you have no create_draft tool. When chasing a lead, write the email text in your reply for Josh to copy, then call mark_lead_contacted.`;

export default async function handler(req, res){
  if(req.method !== 'POST'){ res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if(!requireAuth(req, res)) return;

  const messages = req.body && req.body.messages;
  if(!Array.isArray(messages) || !messages.length){
    return res.status(400).json({ error: 'Body must include a non-empty messages array.' });
  }

  try{
    const gmailToken = await getGmailAccessToken();
    const tools = [...HELM_TOOLS, { type: 'web_search_20250305', name: 'web_search' }];
    const params = {
      model: MODEL,
      max_tokens: 1500,
      system: HELM_SYSTEM_PROMPT + (gmailToken ? '' : NO_GMAIL_NOTE),
      tools,
      messages
    };
    if(gmailToken){
      params.betas = ['mcp-client-2025-11-20'];
      params.mcp_servers = [{ type: 'url', url: GMAIL_MCP_URL, name: 'gmail-mcp', authorization_token: gmailToken }];
      tools.push({ type: 'mcp_toolset', mcp_server_name: 'gmail-mcp' });
    }
    const response = gmailToken
      ? await client.beta.messages.create(params)
      : await client.messages.create(params);
    return res.status(200).json(response);
  }catch(err){
    console.error('Claude request failed', err);
    const status = err instanceof Anthropic.APIError && err.status ? err.status : 502;
    return res.status(status).json({ error: err.message || 'Claude request failed' });
  }
}
