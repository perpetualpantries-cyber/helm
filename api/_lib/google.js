// Exchanges a long-lived Google refresh token for a short-lived access token
// that the Gmail MCP server accepts. Returns null when Gmail isn't configured.
let cached = null; // { token, expiresAt }

export function gmailConfigured(){
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

export async function getGmailAccessToken(){
  if(!gmailConfigured()) return null;
  if(cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if(!res.ok) throw new Error('Google token refresh failed: ' + (data.error_description || data.error || res.status));
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}
