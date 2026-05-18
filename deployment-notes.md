# Deployment Notes

## Current Files

- `index.html`
- `map-module-wardley.md`
- `supabase-waitlist.sql`
- `deployment-notes.md`
- `supabase/migrations/20260518000000_create_waitlist_signups.sql`
- `supabase/functions/waitlist-notify/index.ts`

## GitHub

Repository:

`https://github.com/feygon/SensoryNav`

Pages URL:

`https://feygon.github.io/SensoryNav/`

Pages source:

- Branch: `gh-pages`
- Path: `/`

## Local Git

```powershell
git status
git log --oneline --decorate --all --graph -n 5
```

## Supabase

Supabase cloud project creation still requires a Supabase access token.

Set:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token>"
```

Then create or link a project and push:

```powershell
npx supabase projects list
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy waitlist-notify
```

Set Edge Function secrets:

```powershell
npx supabase secrets set RESEND_API_KEY="<resend-api-key>"
npx supabase secrets set WAITLIST_FROM_EMAIL="SensoryNav <waitlist@your-domain.example>"
npx supabase secrets set WAITLIST_WEBHOOK_SECRET="<random-secret>"
```

Then replace these values in `index.html` and push both `main` and `gh-pages`:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Rows are inserted with:

- `tag = 'waitlist'`

Email notification target:

- `rnickerson@realfeygon.com`

Notification flow:

1. The static site inserts into `public.waitlist_signups`.
2. A Supabase database webhook should call the deployed `waitlist-notify` function on insert.
3. The function sends the notification through Resend.

The webhook still needs to be created in the Supabase dashboard unless you manage it through the Management API.

Configure the webhook to send header:

`x-waitlist-webhook-secret: <WAITLIST_WEBHOOK_SECRET>`

## Codex CLI Notes

Current verified smoke-test state:

- Codex CLI: `0.130.0`
- Model: `gpt-5.5`
- Smoke test completed without WebSocket fallback/reconnect output.
