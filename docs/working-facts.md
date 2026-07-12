# SensoryNav — working facts

**TL;DR:** Quick reference for resuming work (human or agent). Living doc — update as facts change.

## Repo / branching
- `main` HEAD is the deployed state. **Branch off `origin/main` for new work** — the merged `feat/*`
  branches are stale, don't reuse them.
- `main` is **branch-protected**: a PR needs the `test` check green to merge, and **merge to `main`
  auto-deploys** to GitHub Pages (`deploy-pages.yml`).

## Run / test
- Serve locally: `node scripts/serve-out.js` → http://localhost:8137 (serves repo root).
- Tests: `npm test` (plain Node, zero runtime deps). CI: `.github/workflows/test.yml` runs it on every
  push/PR (separate from deploy, no secrets).
- **Byte-identity gate:** regenerate against the committed fixture and diff `out/score-fixture/*-clean.json`
  (fixture `data/fixtures/test-pass-1`). The scorer frontmatter is checked by
  `scripts/generate-scorer-registry.js` (wired into `npm test`).

## Data
- `data/*.wav` + `*.json` are real capture passes (~GB total) and are **gitignored** — present only on the
  owner's machine, so the large-pass tests **skip in CI**.
- Committable CI fixture: `data/fixtures/test-pass-1.{wav,json}` + golden `out/score-fixture/`.
- Aggregation tooling: `scripts/aggregate-rough.js`, `scripts/aggregate-squelch.js`,
  `scripts/plot-roughmap.js`.

## Conventions
- **Functional core / imperative shell:** pure/causal logic lives in units (`mutates: none`); io
  (`fs`/`dom`/`localStorage`/`postMessage`) lives in the shell (`capture.js`, `analyze-worker.js`, CLIs).
- **Scorer units** carry `@unit-begin` frontmatter → `docs/scorer-frontmatter-standard.md`; derived
  registry `docs/scorer-registry.md` (never hand-edited).
- **Reuse-before-build:** `docs/viz-architecture.md` inventory before writing a page/renderer/helper.
- **Dark mode on every page** (`docs/dark-mode.md`); **data-driven artifacts** (fetch JSON + render
  client-side, CSS in linked files).
- Pre-flight gates: read the gate doc before producing — `accessibility.md` before any doc,
  `ux-standards`/`docs/ux-standards.md` before UI, secure-installer before packages, the deploy doc before
  deploy. Code: never Haiku; Sonnet is the floor.

## Deploy
- `.github/workflows/deploy-pages.yml`: pure git + explicit allowlist, **zero marketplace actions**. Serves
  the web files + `recorder/*.js` + the harness worker `MODULES` (derived from `analyze-worker.js`) +
  `harness/tags/registry.json`.
- Branch protection is enshrined as code: `.github/branch-protection/main.json` + `branch-protection.yml`
  (needs an admin PAT; the built-in `GITHUB_TOKEN` can't edit protection).
