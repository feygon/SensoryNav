# Dark mode — the reusable pattern (DRY)

Every SensoryNav page ships dark mode, and our dark mode is **subservient to the
browser's built-in dark mode**: if the visitor hasn't made an explicit choice,
whatever Chrome/the OS reports (`prefers-color-scheme`) wins. An explicit toggle
click overrides and is remembered.

Do **not** reinvent this per page. Reuse the shared module and the snippet below.

## How it works

- **`theme.js`** (shared, one file) is the single source of truth. It:
  - resolves the effective theme = explicit stored choice **→** else the browser
    preference **→** else light;
  - toggles the `dark-mode` class on `<html>` and `<body>`;
  - sets `document.documentElement.style.colorScheme` to the resolved theme so
    **native controls** (form inputs, `<progress>`, scrollbars, pickers) render to
    match — this is the "works with built-in accessibility features" part;
  - persists the user's explicit choice in `localStorage["sensorynav-theme"]`, so
    the preference is **shared across every page** automatically;
  - follows live OS/Chrome scheme changes while no explicit choice is stored;
  - binds every `[data-theme-toggle]` control and exposes `window.SensoryNavTheme`.
- **`styles.css`** declares `:root { color-scheme: light dark; }` (pre-JS/no-JS
  default) and provides `.dark-mode` treatments, including form controls.
- Because `theme.js` is a synchronous `<head>` script, `html.dark-mode` is set
  before the body paints — no flash of the wrong theme.

## The snippet — drop into any new page

In `<head>` (order matters: meta, then stylesheet, then the synchronous script):

```html
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="styles.css?v=0.2.6">
<script src="theme.js?v=0.2.6"></script>
```

A toggle control anywhere in the body (theme.js fills in its icon + label + ARIA):

```html
<button type="button" class="theme-button" data-theme-toggle></button>
```

That's the whole integration. No page-specific theme JS, no per-page color logic.

## Checklist for a new page

- [ ] `<meta name="color-scheme" content="light dark">` present in `<head>`.
- [ ] `styles.css` + `theme.js` included with the **current** `?v=` (bump the
      version when either shared asset changes, on every page that references it).
- [ ] At least one `[data-theme-toggle]` control is present.
- [ ] Any custom surfaces/containers on the page have a `body.dark-mode` /
      `html.dark-mode body` treatment (no pure-white surfaces in dark mode).
- [ ] Native form controls verified in dark mode (they should follow
      `color-scheme` automatically — don't hard-code light backgrounds that defeat it).
