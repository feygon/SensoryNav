# SensoryNav — project directives

## Dark mode & accessibility (applies to every page and rendered artifact)

**Every page or HTML artifact we create MUST ship dark mode, and that dark mode
MUST cooperate with the browser's built-in accessibility features** — not fight
them:

- Default to the visitor's browser/OS preference (`prefers-color-scheme`); our
  theme is **subservient** to Chrome's built-in dark mode. An explicit user
  toggle overrides and is remembered across pages.
- Declare `color-scheme` so native controls (form inputs, `<progress>`,
  scrollbars, pickers) render to match the active theme.
- No pure-white surfaces in dark mode. This is an accessibility requirement — the
  project owner has autistic visual sensory sensitivity; bright surfaces cause
  overstimulation. Dark backgrounds with light text (`#1a1a1a`/`#111` bg,
  `#dcdcdc`/`#eee` text, mid-gray `#555`/`#666` containers).

**Do not reinvent the mechanism per page — reuse the shared pattern.** The
reusable snippet, the shared `theme.js`/`styles.css` contract, and the new-page
checklist live in [`docs/dark-mode.md`](docs/dark-mode.md). Standalone generated
artifacts (e.g. the scorer's `inspection-*.html`, timeline charts) must also be
dark-mode by default with no pure-white surfaces.

When either shared asset (`theme.js`, `styles.css`) changes, bump the `?v=` query
string on **every** page that references it, so cached clients pick up the change.
