# Deployment Notes

## Current Files

- `index.html`
- `map-module-wardley.md`
- `supabase-waitlist.sql`
- `deployment-notes.md`

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

Supabase cloud project creation still requires a Supabase access token or browser login.

Run `supabase-waitlist.sql` in the Supabase SQL editor.

Then replace these values in `index.html`:

```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

Rows are inserted with:

- `tag = 'waitlist'`
- `notify_email = 'rnickerson@realfeygon.com'`

Actual email notifications require a Supabase database webhook, Edge Function, or email provider integration.

## Codex CLI Fix Applied

The local Codex CLI was downgraded from `0.130.0` to `0.122.0`.

`C:\Users\feygo\.codex\config.toml` was also changed:

- removed stale `[windows] sandbox = "unelevated"`
- changed default model from `gpt-5.5` to `gpt-5.4`

Reason:

- `0.130.0` correlated with recurring WebSocket/HTTPS fallback and Windows sandbox ACL issues.
- `0.122.0` is the last locally observed stable version line.
- `gpt-5.5` requires newer Codex versions, so the stable pairing is currently `0.122.0` + `gpt-5.4`.
