# Deployment Notes

## Current Files

- `index.html`
- `map-module-wardley.md`
- `supabase-waitlist.sql`

## Git Blocker

The sandbox can edit files, but shell commands cannot create directories in this workspace.

That blocks `git init`, because Git needs to create `.git/`.

Run this locally from `D:\Repos\SensoryNav`:

```powershell
git init -b main
git add index.html map-module-wardley.md supabase-waitlist.sql deployment-notes.md
git commit -m "Initial SensoryNav site and map module notes"
git checkout -b gh-pages
```

## GitHub Pages

After creating a GitHub repo:

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
git push -u origin gh-pages
```

Then enable Pages from:

`Settings -> Pages -> Deploy from branch -> gh-pages -> /root`

The public URL will usually be:

`https://<owner>.github.io/<repo>/`

## Supabase

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
