# SensoryNav Waitlist Backend

## TLDR

The waitlist now has a repo-local NoSQL-style JSON backend.

- API endpoint: `POST /api/waitlist`
- Data file: `data/waitlist.json`
- Local server: `node server.js`
- No external database or token is required for local use.

This backend must run on a server. Static GitHub Pages cannot execute `server.js`.

The published GitHub Pages site uses FormSubmit's AJAX endpoint to email waitlist submissions to `rnickerson@realfeygon.com`. The repo-local JSON backend is still used when the site is served from `node server.js`.

## Data File

Waitlist records are stored as JSON documents in:

```text
data/waitlist.json
```

Example record:

```json
{
  "email": "example@example.com",
  "tags": ["waitlist"],
  "source": "SensoryNav",
  "last_source": "SensoryNav",
  "created_at": "2026-05-20T10:00:00.000Z",
  "updated_at": "2026-05-20T10:05:00.000Z",
  "signup_count": 2
}
```

## Local Run

```bash
node server.js
```

or:

```bash
npm start
```

Then open:

```text
http://localhost:8787/
```

## Duplicate Behavior

If someone signs up with the same email more than once:

- no duplicate row is added
- `signup_count` increments
- `updated_at` changes
- tags are merged

## Test

```bash
npm test
```

## Deployment Note

GitHub Pages is static. It can serve the frontend files, but it cannot run this backend.

Production signups on GitHub Pages are emailed through FormSubmit because GitHub Pages is static.

To collect real production signups into `data/waitlist.json`, deploy `server.js` somewhere that can run Node, then serve the site from that same origin or set `window.SENSORYNAV_WAITLIST_API_URL` before `app.js` loads.
