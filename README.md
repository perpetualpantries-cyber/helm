# Helm — PP Canopy

Helm is Perpetual Pantries' internal oversight app. It's an installable PWA: open it on a
phone and add it to the home screen. Data syncs across devices through a Neon Postgres
database.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The whole UI. Runs Helm's tool loop in the browser and saves state through `/api/state`. |
| `api/claude.js` | Holds the Anthropic API key and proxies chat requests. The system prompt and tools live in `api/_lib/helm.js`, so the proxy only ever runs Helm. |
| `api/state.js` | Reads and writes the single state document in Neon. Uses version numbers so two devices never silently overwrite each other; the one that saved second reloads the newer copy. |
| `api/cron/auto-execute.js` | Runs once a day and executes timed sales escalations whose 4-day window has passed, even if no device has Helm open. |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable and let it open offline. |

## Deploying on Vercel

1. **Import the repo** into Vercel. Framework preset: *Other*. No build command.
2. **Add Neon.** Project → Storage → Create/Connect → Neon. This sets `DATABASE_URL`.
   The `helm_state` table is created automatically on first request.
3. **Set environment variables** (Project → Settings → Environment Variables):

   | Variable | Required | Purpose |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | yes | Claude API key |
   | `HELM_PASSWORD` | yes | Password you type on each device to sign in |
   | `CRON_SECRET` | yes | Any long random string; Vercel sends it to the cron job |
   | `HELM_MODEL` | no | Defaults to `claude-sonnet-4-6` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | no | Enables Gmail drafts (see below) |

4. **Redeploy** so the variables take effect.

### Gmail drafts (optional)

Without the Google variables, Helm still works but writes outreach emails into the chat
instead of creating Gmail drafts. To enable drafts, create an OAuth client in Google Cloud
Console, get a refresh token for your Google account with Gmail scopes (for example via
the OAuth 2.0 Playground using your own client), and set the three `GOOGLE_*` variables.
The server swaps the refresh token for short-lived access tokens itself.

## Installing on a phone

- **iPhone:** open the site in Safari → Share → *Add to Home Screen*.
- **Android:** open it in Chrome → *Install app* (or menu → *Add to Home screen*).

Sign in with `HELM_PASSWORD` once per device.

## Notes

- The cron runs daily at 21:00 UTC, the most often Vercel's Hobby plan allows. While
  Helm is open it also checks every minute. On a Pro plan you can change the schedule
  in `vercel.json` to hourly (`0 * * * *`).
- Chat history keeps the last 100 messages so the state document stays small.
- Data from the old Claude-artifact version of Helm isn't carried over; the app starts empty.
