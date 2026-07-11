# Scorer units + frontmatter registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the offline scorer (`harness/**`) into cleanly separated, frontmatter-documented units, carving the reusable pure/causal cores out of the `compose`/fusion functions — without changing any numeric output.

**Architecture:** Add a frontmatter block to every scorer unit and a generator that scrapes them into a derived registry AND runs six build-time checks. Then classify every module (zero code change), then carve five `compose`/fusion targets one at a time, each gated by a whole-pass byte-identity diff. Functional core, imperative shell: cores return values; io stays in the worker/CLI shell.

**Tech Stack:** Node (CommonJS, zero runtime deps), plain `node tests/*.test.js` suite, dual Node/browser export (`module.exports` + `self.SensoryNavScore`), GitHub Actions (`test.yml`).

## Global Constraints

- **Byte-identical batch output is the hard invariant.** `out/score-jc4/*-clean.json` must regenerate bit-for-bit identical to the committed golden after every task. Any diff = the task is wrong.
- **No algorithm rewrites.** Carving relocates existing logic and may change interfaces (de-closuring), but never the math.
- **No new runtime dependencies.** The generator is first-party Node, like `scripts/generate-viz-inventory.js`.
- **Unit size:** each carved core and each residual `compose` recipe targets ~100 lines, hard block 300.
- **Dual export convention:** every `harness/**` module keeps `module.exports = {…}` AND `self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, {…})`, with the cross-env guard `var {X} = (typeof require !== "undefined") ? require("…") : self.SensoryNavScore`.
- **Frontmatter block** goes AFTER the module's prose `//` one-liner (so `generate-viz-inventory.js` still scrapes the prose). Field format and the six checks: `docs/scorer-frontmatter-standard.md`.
- **Weights** are `CONSTANTS.WEIGHTS = {low:0.6, mid:0.3, high:0.1}` (passed as parameters, never read ambiently in a carved core).
- Spec: `docs/superpowers/specs/2026-07-09-scorer-units-and-frontmatter-design.md`. Per-module map = spec §6.

## File Structure

**Created:**
- `scripts/generate-scorer-registry.js` — scrapes `@unit-begin` blocks, emits the registry, runs the six checks (exit non-zero on failure).
- `docs/scorer-registry.md` — GENERATED; never hand-edited.
- `scripts/make-fixture-pass.js` — one-off: writes a short committable fixture pass (`data/fixtures/test-pass-1.{wav,json}`) trimmed from a real pass, plus its mini-golden under `out/score-fixture/`.
- `data/fixtures/test-pass-1.wav`, `data/fixtures/test-pass-1.json` — committed tiny fixture (< ~1 MB).
- `out/score-fixture/{scored,highres,squelch,tags}-clean.json` — committed mini-golden for the fixture.
- Per-core test files under `tests/` (Phase C): `tests/kalman-step.test.js`, `tests/score-frontend-core.test.js`, `tests/score-window.test.js`, `tests/join-windows.test.js`, `tests/tag-value.test.js`, `tests/event-carve.test.js`.

**Modified:**
- `package.json` — add the generator + fixture byte-identity tests to the `test` script.
- Every `harness/**` module — add a frontmatter block (Phase B/C).
- The five carve-target modules (Phase C): `harness/motion/kalman-smoother.js`, `harness/score/score-frontend.js`, `harness/score/research-scorer.js`, `harness/score/squelch-derive.js`, `harness/tags/events.js` — extract cores.
- `.github/workflows/*` — unchanged (the fixture makes the existing byte-identity tests execute in CI).

---

# PHASE A — Standard, generator, registry, CI fixture

## Task A1: The registry generator + six checks

**Files:**
- Create: `scripts/generate-scorer-registry.js`
- Create: `docs/scorer-registry.md` (generator output)
- Test: `tests/scorer-registry.test.js`

**Interfaces:**
- Produces: CLI `node scripts/generate-scorer-registry.js` (writes the registry; exits 0 clean, non-zero on any check failure). Module export `{ scan, check, render }` for the test.
  - `scan(rootDir) -> units[]` where a unit = `{ rel, block|null, exports[] }` and `block = {unit,causality,state,mutates,contract[],deps,realtime,testedBy[]}`.
  - `check(units) -> violations[]` (each `{rel, rule, detail}`); the six mechanical checks.
  - `render(units) -> markdownString`.

- [ ] **Step 1: Write the failing test**

```js
// tests/scorer-registry.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const G = require("../scripts/generate-scorer-registry.js");

// Build a throwaway module tree so the test is hermetic.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
const mod = path.join(dir, "score");
fs.mkdirSync(mod, { recursive: true });
function write(name, src) { fs.writeFileSync(path.join(mod, name), src); }

// A clean, valid unit.
write("good.js", [
  "// good.js",
  "// A pure demo unit.",
  "// @unit-begin",
  "// unit:       good",
  "// causality:  pure",
  "// state:      none",
  "// mutates:    none",
  "// contract:   good(x) -> number",
  "// deps:       —",
  "// realtime:   reuse-as-is",
  "// tested-by:  tests/good.test.js",
  "// @unit-end",
  "function good(x){return x;} module.exports={good};",
  ""
].join("\n"));

// pure + state:none but mutates:data → rule 6 (contradiction).
write("liar.js", [
  "// liar.js",
  "// Claims pure but mutates.",
  "// @unit-begin",
  "// unit:       liar",
  "// causality:  pure",
  "// state:      none",
  "// mutates:    data:cache",
  "// contract:   liar(x) -> number",
  "// deps:       —",
  "// realtime:   reuse-as-is",
  "// tested-by:  tests/good.test.js",
  "// @unit-end",
  "module.exports={liar:function(){}};",
  ""
].join("\n"));

// No block at all → rule 1.
write("undocumented.js", "// undocumented.js\nmodule.exports={foo:1};\n");

// Make tested-by resolvable for the good/liar cases.
fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
fs.writeFileSync(path.join(dir, "tests", "good.test.js"), "");

const units = G.scan(mod);
assert.strictEqual(units.length, 3, "scans every .js file");
const good = units.find((u) => u.rel.endsWith("good.js"));
assert.ok(good.block, "parses the block");
assert.strictEqual(good.block.causality, "pure");
assert.deepStrictEqual(good.block.contract, ["good(x) -> number"]);

const v = G.check(units, dir); // dir = repo root for tested-by resolution
const rules = v.map((x) => x.rule).sort();
assert.ok(rules.includes("no-block"), "flags the undocumented module");
assert.ok(rules.includes("pure-mutates"), "flags the pure+mutates contradiction");

// render produces a grouped table mentioning each unit.
const md = G.render(units);
assert.ok(/good/.test(md) && /liar/.test(md), "renders every unit");
console.log("scorer-registry tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scorer-registry.test.js`
Expected: FAIL — `Cannot find module '../scripts/generate-scorer-registry.js'`.

- [ ] **Step 3: Write the generator**

```js
// scripts/generate-scorer-registry.js
// Scrapes the @unit-begin…@unit-end frontmatter block from every harness/** module into a derived
// registry (docs/scorer-registry.md) AND runs six mechanical checks. Exits non-zero on any failure,
// so it doubles as a test. Format + rules: docs/scorer-frontmatter-standard.md. Derived — never
// hand-edit the .md.
"use strict";
const fs = require("fs");
const path = require("path");

const CAUSALITY = ["pure", "causal", "acausal", "compose"];
const REALTIME = ["reuse-as-is", "needs-streaming-variant", "batch-only"];
const REQUIRED = ["unit", "causality", "state", "mutates", "contract", "realtime", "tested-by"];

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

// Pull the fenced block; return { fields } or null. contract accumulates continuation lines.
function parseBlock(src) {
  const m = src.match(/\/\/\s*@unit-begin([\s\S]*?)\/\/\s*@unit-end/);
  if (!m) return null;
  const fields = { contract: [], testedBy: [] };
  let last = null;
  for (const raw of m[1].split("\n")) {
    const line = raw.replace(/^\s*\/\/ ?/, "").replace(/\s+\/\/.*$/, "").trimEnd(); // strip comment marker + trailing // note
    if (!line.trim()) continue;
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1], val = kv[2].trim();
      last = key;
      if (key === "contract") fields.contract.push(val);
      else if (key === "tested-by") fields.testedBy = val.split(/[,\s]+/).filter(Boolean).filter((x) => x !== "—");
      else fields[key] = val;
    } else if (last === "contract") {
      fields.contract.push(line.trim()); // continuation
    }
  }
  return fields;
}

// module.exports = {…} names + const exported|api = {…} names.
function exportNames(src) {
  const names = new Set();
  const grab = (body) => body.split(",").forEach((p) => { const n = p.split(":")[0].trim().replace(/['"]/g, ""); if (/^\w+$/.test(n)) names.add(n); });
  let m = src.match(/module\.exports\s*=\s*\{([^}]*)\}/); if (m) grab(m[1]);
  m = src.match(/(?:const|var|let)\s+(?:exported|api)\s*=\s*\{([^}]*)\}/); if (m) grab(m[1]);
  return names;
}

// The public entry-point name of a contract line = the first `ident(` occurrence.
function contractFns(contractLines) {
  const fns = [];
  for (const line of contractLines) { const m = line.match(/([A-Za-z_]\w*)\s*\(/); if (m) fns.push(m[1]); }
  return fns;
}

function scan(rootDir) {
  return listJs(rootDir).map((abs) => {
    const src = fs.readFileSync(abs, "utf8");
    const fields = parseBlock(src);
    return {
      rel: abs,
      block: fields ? {
        unit: fields.unit, causality: fields.causality, state: fields.state, mutates: fields.mutates,
        contract: fields.contract, deps: fields.deps || "—", realtime: fields.realtime, testedBy: fields.testedBy
      } : null,
      exports: exportNames(src)
    };
  });
}

// The six mechanical checks. `repoRoot` resolves tested-by paths.
function check(units, repoRoot) {
  const v = [];
  const add = (u, rule, detail) => v.push({ rel: u.rel, rule, detail });
  for (const u of units) {
    if (!u.block) { add(u, "no-block", "no @unit-begin block"); continue; }
    const b = u.block;
    for (const f of REQUIRED) {
      const present = f === "tested-by" ? b.testedBy.length : f === "contract" ? b.contract.length : b[f];
      if (!present) add(u, "missing-field", "missing " + f);
    }
    if (b.causality && !CAUSALITY.includes(b.causality)) add(u, "bad-value", "causality=" + b.causality);
    if (b.realtime && !REALTIME.includes(b.realtime)) add(u, "bad-value", "realtime=" + b.realtime);
    if (b.state && !/^(none|carried:.+)$/.test(b.state)) add(u, "bad-value", "state=" + b.state);
    if (b.mutates && !/^(none|input:.+|setting:.+|data:.+|io:.+)$/.test(b.mutates)) add(u, "bad-value", "mutates=" + b.mutates);
    if (/^setting:/.test(b.mutates || "")) add(u, "mutates-setting", b.mutates);
    for (const fn of contractFns(b.contract)) if (!u.exports.has(fn)) add(u, "contract-unexported", fn);
    for (const t of b.testedBy) if (!fs.existsSync(path.join(repoRoot, t))) add(u, "dangling-tested-by", t);
    if (b.causality === "pure" && b.state === "none" && b.mutates && b.mutates !== "none") add(u, "pure-mutates", b.mutates);
  }
  return v;
}

function render(units) {
  const rows = units.filter((u) => u.block).sort((a, b) => a.block.causality.localeCompare(b.block.causality) || a.rel.localeCompare(b.rel));
  const esc = (s) => String(s || "—").replace(/\|/g, "\\|");
  let md = "<!-- GENERATED by scripts/generate-scorer-registry.js — do not hand-edit. -->\n";
  md += "# Scorer unit registry\n\nDerived from the `@unit-begin` frontmatter in `harness/**`. Regenerate with `node scripts/generate-scorer-registry.js`.\n\n";
  md += "Every dual-export unit attaches to `self.SensoryNavScore` at load (a uniform load-time effect, not per-call).\n\n";
  md += "| unit | causality | state | mutates | contract | deps | realtime | tested-by |\n|---|---|---|---|---|---|---|---|\n";
  for (const u of rows) {
    const b = u.block, relShort = u.rel.replace(/\\/g, "/").replace(/.*?(harness\/.*)$/, "$1");
    md += "| `" + relShort + "` | " + b.causality + " | " + esc(b.state) + " | " + esc(b.mutates) + " | " + esc(b.contract.join(" · ")) + " | " + esc(b.deps) + " | " + b.realtime + " | " + esc(b.testedBy.join(", ")) + " |\n";
  }
  return md;
}

module.exports = { scan, check, render };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const units = scan(path.join(root, "harness"));
  const violations = check(units, root);
  if (violations.length) {
    for (const x of violations) console.error("scorer-registry: " + x.rule + " — " + x.rel.replace(/\\/g, "/") + " — " + x.detail);
    console.error("scorer-registry: " + violations.length + " violation(s)");
    process.exit(1);
  }
  fs.writeFileSync(path.join(root, "docs", "scorer-registry.md"), render(units));
  console.log("wrote docs/scorer-registry.md — " + units.filter((u) => u.block).length + " units");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/scorer-registry.test.js`
Expected: PASS — `scorer-registry tests passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-scorer-registry.js tests/scorer-registry.test.js
git commit -m "feat(scorer): frontmatter registry generator with six checks"
```

## Task A2: Wire the generator into `npm test` (expected: red until Phase B)

**Files:**
- Modify: `package.json` (the `test` script), append the registry check and the registry unit test.

**Interfaces:**
- Consumes: `scripts/generate-scorer-registry.js` (A1).
- Produces: `npm test` now runs `node scripts/generate-scorer-registry.js` — which will FAIL until every `harness/**` module has a block (Phase B). That failure is expected and drives Phase B.

- [ ] **Step 1: Add the two entries to the `test` script**

Append to the `&&`-chain in `package.json`'s `"test"` (order: registry unit test early, the generator check LAST so it doesn't mask other failures):

```
… && node tests/scorer-registry.test.js && node scripts/generate-scorer-registry.js
```

- [ ] **Step 2: Run and confirm the generator flags the undocumented modules**

Run: `node scripts/generate-scorer-registry.js`
Expected: FAIL — a `no-block` line for every `harness/**` module (none have blocks yet), non-zero exit. This is the Phase B worklist.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build(scorer): run the registry generator in npm test (red until classified)"
```

## Task A3: Committable fixture pass + mini-golden

**Files:**
- Create: `scripts/make-fixture-pass.js`
- Create: `data/fixtures/test-pass-1.wav`, `data/fixtures/test-pass-1.json` (generated, committed)
- Create: `out/score-fixture/{scored,highres,squelch,tags}-clean.json` (generated, committed)
- Modify: `.gitignore` — un-ignore `data/fixtures/` and `out/score-fixture/` (they must be committed).

**Interfaces:**
- Consumes: `recorder/trim-capture.js` `trimCapture`, `harness/audio/wav-decoder.js` `decodeWav`, `recorder/wav-encoder.js` `encodeWav`, the scorer CLIs (`scripts/score-research.js`, `scripts/squelch-extract.js`).
- Produces: a ~5 s committed fixture pass + its golden, so `tests/score-frontend.test.js`, `research-scorer`, `squelch-derive`, `analyze-pipeline` gain a fixture that EXECUTES in CI (Phase C repoints their pass-4 reads to the fixture, or adds a fixture-based twin — see Task A4).

- [ ] **Step 1: Write the fixture generator**

```js
// scripts/make-fixture-pass.js — one-off. Trims a real pass down to a small, committable clip and
// regenerates its golden. Run: node scripts/make-fixture-pass.js <src-sidecar.json> [keepSec]
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder.js");
const { encodeWav } = require("../recorder/wav-encoder.js");
const { trimCapture } = require("../recorder/trim-capture.js");

const srcJson = process.argv[2];
const keepSec = Number(process.argv[3] || 5);
if (!srcJson) { console.error("usage: make-fixture-pass.js <sidecar.json> [keepSec]"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(srcJson, "utf8"));
const srcWav = path.join(path.dirname(srcJson), sidecar.audio.wav_filename);
const { samples, sampleRate } = decodeWav(fs.readFileSync(srcWav));
const total = samples.length;
const dropLastSec = Math.max(0, total / sampleRate - keepSec);

const trimmed = trimCapture(
  { frames: [samples], totalSamples: total, sampleRate,
    recordingStartMs: sidecar.recording_start_ms, audioFirstFrameMs: sidecar.audio_first_frame_ms,
    gpsSamples: sidecar.gps_samples },
  { dropLastSec });
if (!trimmed) { console.error("keepSec too small — nothing remains"); process.exit(1); }

const outDir = path.join(__dirname, "..", "data", "fixtures");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "test-pass-1.wav"), Buffer.from(encodeWav(trimmed.frames, trimmed.totalSamples, sampleRate)));
const newSidecar = Object.assign({}, sidecar, {
  pass_label: "test-pass-1",
  duration_ms: (trimmed.totalSamples / sampleRate) * 1000,
  audio: Object.assign({}, sidecar.audio, { wav_filename: "test-pass-1.wav" }),
  gps_samples: trimmed.gpsSamples
});
fs.writeFileSync(path.join(outDir, "test-pass-1.json"), JSON.stringify(newSidecar, null, 2));
console.log("wrote data/fixtures/test-pass-1.{wav,json} —", (trimmed.totalSamples / sampleRate).toFixed(1), "s,",
  (Buffer.from(encodeWav(trimmed.frames, trimmed.totalSamples, sampleRate)).length / 1e6).toFixed(2), "MB");
```

- [ ] **Step 2: Generate the fixture from a real pass**

Run: `node scripts/make-fixture-pass.js data/johnson-creek-pass-4-181806.json 5`
Expected: writes `data/fixtures/test-pass-1.{wav,json}`, prints ~5.0 s and a sub-MB size. (If pass-4 is absent on your machine, use any local `data/*.json` pass ≥ 6 s.)

- [ ] **Step 3: Regenerate the mini-golden for the fixture**

Run:
```bash
node scripts/score-research.js data/fixtures/test-pass-1.json out/score-fixture
node scripts/squelch-extract.js data/fixtures/test-pass-1.json out/score-fixture
```
Expected: writes `out/score-fixture/{scored,highres,squelch,tags}-clean.json`.

- [ ] **Step 4: Un-ignore and commit the fixture + golden**

Add to `.gitignore` (negate the existing `data/` / `out/` ignores):
```
!data/fixtures/
!out/score-fixture/
```

```bash
git add -f data/fixtures/test-pass-1.wav data/fixtures/test-pass-1.json out/score-fixture/*.json .gitignore scripts/make-fixture-pass.js
git commit -m "test(scorer): commit a tiny fixture pass + mini-golden for CI byte-identity"
```

## Task A4: Fixture-based byte-identity tests that run in CI

**Files:**
- Create: `tests/fixture-pipeline.test.js` (hermetic against the committed fixture — mirrors `analyze-pipeline.test.js` but reads `data/fixtures/` + `out/score-fixture/`, so it does NOT skip in CI).
- Modify: `package.json` — add it to the `test` chain.

**Interfaces:**
- Consumes: the committed fixture + golden (A3); the scorer chain (`score-frontend`, `speech-detect`, `research-scorer`, `squelch-derive`, `tags/schema`).
- Produces: a byte-identity test with NO `have()`/skip guard — it is the CI-enforced golden gate for Phase C.

- [ ] **Step 1: Write the test**

```js
// tests/fixture-pipeline.test.js — CI-enforced byte-identity gate on the COMMITTED fixture (no skip).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const { scoreResearch } = require("../harness/score/research-scorer.js");
const { deriveSquelch } = require("../harness/score/squelch-derive.js");
const { loadRegistry } = require("../harness/tags/schema.js");

const sc = path.join(__dirname, "..", "data", "fixtures", "test-pass-1.json");
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored } = scoreResearch(Object.assign({}, front, { speech }), {});
const registry = loadRegistry(path.join(__dirname, "..", "harness", "tags", "registry"));
const { tags } = deriveSquelch(front, front.samples, front.sr, { registry });

const G = path.join(__dirname, "..", "out", "score-fixture");
assert.strictEqual(JSON.stringify(scored, null, 2), fs.readFileSync(path.join(G, "scored-clean.json"), "utf8"), "scored byte-identical");
assert.strictEqual(JSON.stringify(tags), fs.readFileSync(path.join(G, "tags-clean.json"), "utf8"), "tags byte-identical");
console.log("fixture-pipeline tests passed");
```

- [ ] **Step 2: Run it (fixture present)**

Run: `node tests/fixture-pipeline.test.js`
Expected: PASS — `fixture-pipeline tests passed`.

- [ ] **Step 3: Add to `npm test` and commit**

Append `&& node tests/fixture-pipeline.test.js` to the `test` script.

```bash
git add tests/fixture-pipeline.test.js package.json
git commit -m "test(scorer): CI-enforced byte-identity gate on the committed fixture"
```

---

# PHASE B — Classify (block-only, zero code change)

Add an `@unit-begin` block to every `harness/**` module per spec §6. No logic changes ⇒ byte-identity holds trivially. Work module-by-module; after each batch, run the generator until it passes.

## Task B1..Bn: Add frontmatter blocks (one commit per directory)

**Files:** every `.js` under `harness/audio`, `harness/motion`, `harness/score`, `harness/tags`.

**Interfaces:**
- Consumes: A1 generator (defines the format + checks).
- Produces: a fully-populated registry; `node scripts/generate-scorer-registry.js` exits 0.

- [ ] **Step 1: For each module, insert the block after its prose `//` line.** Field values come from spec §6 + reading the module's exports. Template (fill per module):

```js
// @unit-begin
// unit:       <filename-stem>
// causality:  <pure|causal|acausal|compose>
// state:      <none|carried:<shape>>
// mutates:    <none|input:<n>|data:<n>|io:<sink>>   // audit by READING the body, not assuming
// contract:   <entryFn(args) -> return>             // multi-line for compose units
// deps:       <sibling units, or —>
// realtime:   <reuse-as-is|needs-streaming-variant|batch-only>
// tested-by:  tests/<existing-test>.test.js
// @unit-end
```

Authoritative per-module values (spec §6):

| module | causality | mutates (verify) | realtime |
|---|---|---|---|
| `motion/linalg`, `motion/geo-project`, `score/metrics`, `score/reliability`, `score/roughness-db`, `tags/schema` | pure | none | reuse-as-is |
| `audio/fft` | pure | **verify `input:` (in-place)** | reuse-as-is |
| `audio/audio-windows`, `score/spectral-chaos` | causal | none | reuse-as-is |
| `audio/wav-decoder` | pure | none | reuse-as-is |
| `score/baseline` | `fitBaseline` acausal / `floorAt` pure | none | fitBaseline: needs-streaming-variant; floorAt: reuse-as-is |
| `score/validate`, `score/felt`, `score/report`, `score/run-scorer`, `score/score-pass`, `score/roughness`, `audio/load-pass` | acausal | (audit; `report`/`run-scorer` are `io:fs`) | batch-only |
| `score/speech-detect` | causal | none | reuse-as-is |
| `motion/motion-track` | compose/acausal | none | batch-only |
| `tags/extract` | `extractTags` compose / `confidence` pure | none | extractTags batch-only; confidence reuse-as-is |
| `motion/kalman-smoother`, `score/score-frontend`, `score/research-scorer`, `score/squelch-derive`, `tags/events` | (compose — carved in Phase C; block them now with their CURRENT contract, update during the carve) | audit | — |

- [ ] **Step 2: After each directory, run the generator**

Run: `node scripts/generate-scorer-registry.js`
Expected: fewer `no-block` violations each pass; 0 when the directory is done. Fix any `contract-unexported` / `bad-value` / `pure-mutates` it reports (those are real — e.g. if `fft` mutates its input, set `mutates: input:<name>`, not `none`).

- [ ] **Step 3: Byte-identity spot check (must be unchanged — no code touched)**

Run:
```bash
node scripts/score-research.js data/fixtures/test-pass-1.json /tmp/chk && diff <(cat /tmp/chk/scored-clean.json) out/score-fixture/scored-clean.json && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 4: Commit per directory**

```bash
git add harness/<dir> docs/scorer-registry.md
git commit -m "docs(scorer): frontmatter blocks for harness/<dir>"
```

- [ ] **Step 5: Final Phase-B gate**

Run: `npm test`
Expected: green — the generator now passes; all existing + fixture tests pass. Commit the regenerated `docs/scorer-registry.md` if not already.

---

# PHASE C — Carve (one target per task, byte-identity-gated)

Each carve: extract the core into a named export, add a deterministic unit test, run the byte-identity gate, add the equivalence test, regenerate the registry, commit. **Order:** C1→C5. Do not start the next until the current is byte-identical green.

**Every Phase C task ends with this exit gate (the "byte-identity gate" step):**
```bash
node scripts/score-research.js data/fixtures/test-pass-1.json /tmp/chk
node scripts/squelch-extract.js data/fixtures/test-pass-1.json /tmp/chk
diff /tmp/chk/scored-clean.json out/score-fixture/scored-clean.json \
 && diff /tmp/chk/squelch-clean.json out/score-fixture/squelch-clean.json \
 && diff /tmp/chk/tags-clean.json out/score-fixture/tags-clean.json && echo IDENTICAL
npm test
```
Expected: `IDENTICAL` + green suite. If any diff appears, `git revert` the carve and retry — the tree must be byte-identical between carves (Global Constraints; spec §12 rollback).

## Task C1: `kalman-smoother` — add the `kalmanStep` core

**Files:**
- Modify: `harness/motion/kalman-smoother.js` — factor the per-fix predict+update body of `forwardFilter` into an exported pure `kalmanStep(state, fix) -> {state, out}`; have `forwardFilter` fold it. Update the block's `contract` to add `kalmanStep`.
- Test: `tests/kalman-step.test.js`

**Interfaces:**
- Produces: `kalmanStep(state, fix) -> { state, out }` — `state` carried, returned fresh (`mutates: none`); `forwardFilter(points, sigmaA)` unchanged externally.

- [ ] **Step 1: Write the failing per-core test**

```js
// tests/kalman-step.test.js
"use strict";
const assert = require("assert");
const { kalmanStep, forwardFilter } = require("../harness/motion/kalman-smoother.js");
// Folding kalmanStep over a sequence reproduces forwardFilter's per-step estimate.
const pts = [ {t:0,x:0,y:0}, {t:1,x:1,y:0}, {t:2,x:2,y:0} ];
const ff = forwardFilter(pts, 1);
let st = null, out = [];
for (const p of pts) { const r = kalmanStep(st, p); st = r.state; out.push(r.out); }
assert.strictEqual(out.length, ff.length);
assert.ok(Math.abs(out[2].s[0] - ff[2].s[0]) < 1e-9, "step fold matches forwardFilter");
// determinism + no input mutation
const before = JSON.stringify(pts[1]);
kalmanStep(null, pts[1]);
assert.strictEqual(JSON.stringify(pts[1]), before, "does not mutate its input fix");
console.log("kalman-step tests passed");
```
(Adjust `s`/`out` field names to the module's actual filtered-state shape when implementing — read `forwardFilter`'s return.)

- [ ] **Step 2: Run to verify it fails** — `node tests/kalman-step.test.js` → FAIL (`kalmanStep` undefined).
- [ ] **Step 3: Extract `kalmanStep`.** In `harness/motion/kalman-smoother.js`, move the loop body of `forwardFilter` (the predict → gain → update for one point) into `function kalmanStep(state, fix){ … return {state:next, out}; }` (initialize from `INIT_VEL_VAR` when `state==null`). Rewrite `forwardFilter` to `points.reduce`/loop calling `kalmanStep`. Add `kalmanStep` to `module.exports`/`self` and to the `contract` line.
- [ ] **Step 4: Run the core test** — `node tests/kalman-step.test.js` → PASS.
- [ ] **Step 5: Add the equivalence test** — assert `forwardFilter` output is unchanged vs a pre-carve snapshot (or that `rtsBackward(forwardFilter(...))` still matches). Reuse the byte-identity gate below as the composition proof.
- [ ] **Step 6: Regenerate registry** — `node scripts/generate-scorer-registry.js` → 0 violations.
- [ ] **Step 7: BYTE-IDENTITY GATE** (the block above) → `IDENTICAL` + green.
- [ ] **Step 8: Commit**
```bash
git add harness/motion/kalman-smoother.js tests/kalman-step.test.js docs/scorer-registry.md package.json
git commit -m "refactor(motion): carve pure kalmanStep out of forwardFilter"
```
(Add `node tests/kalman-step.test.js` to `package.json`'s test chain in this commit.)

## Task C2: `score-frontend` — separate the causal front-end from acausal smoothing

**Files:**
- Modify: `harness/score/score-frontend.js` — expose `buildWindows(wavBytes, audioFirstFrameMs) -> {samples,sr,sp1,frames}` (causal: decode→framesToWindows→stft) separately from the SP2 motion smoothing; `buildFrontEnd` composes `buildWindows` + `buildMotionTrack`.
- Test: `tests/score-frontend-core.test.js`

**Interfaces:**
- Produces: `buildWindows(wavBytes, audioFirstFrameMs) -> {samples,sr,sp1,frames}` (`causal`, `mutates:none`); `buildFrontEnd(...)` unchanged externally.

- [ ] **Step 1: Failing test** — assert `buildWindows` returns `sp1.length>0`, `frames.length>sp1.length`, and that `buildFrontEnd`'s `sp1`/`frames` deep-equal `buildWindows`'s on the fixture.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extract `buildWindows`** — move the decode/`framesToWindows`/`stft` steps of `buildFrontEnd` into `buildWindows`; `buildFrontEnd` calls it then runs `buildMotionTrack`. Export + block `contract` update.
- [ ] **Step 4: Run core test → PASS.**
- [ ] **Step 5: Equivalence** — deep-equal `buildFrontEnd().{sp1,frames}` vs `buildWindows()` on the fixture.
- [ ] **Step 6: Regenerate registry.**
- [ ] **Step 7: BYTE-IDENTITY GATE → IDENTICAL + green.**
- [ ] **Step 8: Commit** `refactor(score): carve causal buildWindows out of buildFrontEnd` (add the test to `package.json`).

## Task C3: `research-scorer` — carve the `scoreWindow` core

**Files:**
- Modify: `harness/score/research-scorer.js` — extract the per-window scoring body of the `scoreResearch` loop into `scoreWindow(window, floors, weights) -> row`; `scoreResearch` does acausal prep (baseline fit + speech ranges) then `map`s `scoreWindow`.
- Test: `tests/score-window.test.js`

**Interfaces:**
- Produces: `scoreWindow(window, floors, weights) -> row` (`pure`, `mutates:none`), where `row` is the 18-key scored entry; `scoreResearch(front, opts)` unchanged externally.

- [ ] **Step 1: Failing test** — construct a synthetic `window`, `floors`, `weights`; assert `scoreWindow` returns the documented keys and that `roughness_raw` rises with band energy. Assert calling it twice with the same input gives an identical object (determinism) and does not mutate `window`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extract `scoreWindow`** — lift the loop body (the per-window delta-dB + weighting + the 18-key row assembly) into `scoreWindow`; `scoreResearch` keeps the acausal prep and calls `scored = windows.map(w => scoreWindow(w, floorsAt(w), RW))`. Export + block update (multi-line contract: `scoreResearch(...)` · `scoreWindow(...)`).
- [ ] **Step 4: Run core test → PASS.**
- [ ] **Step 5: Equivalence** — assert `scoreResearch` output byte-equals the committed `out/score-fixture/scored-clean.json` (this IS `tests/fixture-pipeline.test.js`; confirm it still passes).
- [ ] **Step 6: Regenerate registry.**
- [ ] **Step 7: BYTE-IDENTITY GATE → IDENTICAL + green.**
- [ ] **Step 8: Commit** `refactor(score): carve pure scoreWindow out of scoreResearch` (add the test).

## Task C4: `squelch-derive` — `joinWindows` + de-closure `valueFor`/`reliabilityFor`

**Files:**
- Modify: `harness/score/squelch-derive.js` — (a) extract the chaos↔scored-window alignment into `joinWindows(chaosSeries, scoredWindows, floors) -> rows[{t,chaos,tonality,level_db,floor_db,speed,reliability,low_conf}]`; (b) de-closure `makeValueFor(sq,baseline,eventCtx)→valueFor(name,event)` into pure `valueFor(name, event, ctx)` and `makeReliabilityFor(sq,eventCtx)→reliabilityFor(name,event)` into pure `reliabilityFor(name, event, ctx)`, with `ctx = {bands:{subbass,low,mid,high}, bandN, floorAt:(band,speed)->floor, window:{speed,reliability}}`; `buildTagEvents` builds `ctx` per event (`window` = the nearest scored window) and calls the pure fns.
- Test: `tests/join-windows.test.js`, `tests/tag-value.test.js`

**Interfaces:**
- Produces: `joinWindows(chaosSeries, scoredWindows, floors) -> rows[…]` (`pure`); `valueFor(name, event, ctx) -> number|null` (`pure`); `reliabilityFor(name, event, ctx) -> number` (`pure`). `deriveSquelch(front, samples, sr, opts)` unchanged externally.

- [ ] **Step 1: Failing tests.** `join-windows.test.js`: feed two short synthetic series, assert one row per window carrying all eight fields. `tag-value.test.js`: build a synthetic `ctx` (subbass slice with known tonality) + `event`, assert `valueFor("tonality",…)` = the median, and `reliabilityFor` = 0 when a window is `low_conf`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Extract + de-closure.** Pull the `nearestIndex` join into `joinWindows`. Replace the `makeValueFor`/`makeReliabilityFor` closures with pure `valueFor(name,event,ctx)`/`reliabilityFor(name,event,ctx)` — move the closed-over `sq`/`baseline`/`eventCtx` reads onto `ctx.bands`/`ctx.bandN`/`ctx.floorAt`/`ctx.window`. In `buildTagEvents`, compute `ctx` per event and pass it. Export the three; multi-line `contract`.
- [ ] **Step 4: Run core tests → PASS.**
- [ ] **Step 5: Equivalence** — `tests/fixture-pipeline.test.js` (`tags` byte-equal) plus an explicit assert that `valueFor`/`reliabilityFor` reproduce the pre-carve closures on the fixture events.
- [ ] **Step 6: Regenerate registry.**
- [ ] **Step 7: BYTE-IDENTITY GATE → IDENTICAL + green** (esp. `squelch-clean.json` + `tags-clean.json`).
- [ ] **Step 8: Commit** `refactor(score): joinWindows + de-closure valueFor/reliabilityFor` (add both tests).

## Task C5: `tags/events` — `chaosThreshold` + `seedWindow` + `segmentEvents`

**Files:**
- Modify: `harness/tags/events.js` — split `detectEvents(series,opts)` into `chaosThreshold(series) -> thr` (acausal), `seedWindow(row, thr) -> bool` (pure; PRESERVE `chaos>thr && !low_conf` exactly), `segmentEvents(rows, seedFn, opts) -> events[]` (causal:carried run-length+merge+split+min-len); `detectEvents` composes them.
- Test: `tests/event-carve.test.js`

**Interfaces:**
- Produces: `chaosThreshold(series) -> number`, `seedWindow(row, thr) -> boolean`, `segmentEvents(rows, seedFn, opts) -> events[]`; `detectEvents(series, opts)` unchanged externally.

- [ ] **Step 1: Failing test** — assert `seedWindow({chaos:0.9,low_conf:false}, 0.5)===true`, `seedWindow({chaos:0.9,low_conf:true},0.5)===false`, `seedWindow({chaos:0.4,low_conf:false},0.5)===false`; and that `segmentEvents(series, seedWindowWithThr, opts)` reproduces `detectEvents(series, opts)` on a synthetic series.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Split.** Extract the `pct(...)` threshold into `chaosThreshold`; the `series[i].chaos > thr && !series[i].low_conf` predicate into `seedWindow(row, thr)`; the run-length/merge/split/min-len assembly into `segmentEvents(rows, seedFn, opts)`. `detectEvents = (series,opts) => segmentEvents(series, r => seedWindow(r, chaosThreshold(series)), opts)`. Export the three; multi-line contract.
- [ ] **Step 4: Run core test → PASS.**
- [ ] **Step 5: Equivalence** — `detectEvents` output deep-equals its pre-split behavior on the fixture (covered by `tags` byte-identity).
- [ ] **Step 6: Regenerate registry.**
- [ ] **Step 7: BYTE-IDENTITY GATE → IDENTICAL + green.**
- [ ] **Step 8: Commit** `refactor(tags): carve chaosThreshold/seedWindow/segmentEvents out of detectEvents` (add the test).

---

# PHASE D — Close

## Task D1: Final registry, size audit, whole-branch review

**Files:** `docs/scorer-registry.md`; `docs/viz-architecture.md` (if any export surface changed).

- [ ] **Step 1: Regenerate both derived docs.** `node scripts/generate-scorer-registry.js` and `node scripts/generate-viz-inventory.js`; commit any diff.
- [ ] **Step 2: Size audit.** Confirm each carved core and each residual `compose` recipe is < 300 lines (target ~100): `for f in harness/motion/kalman-smoother.js harness/score/score-frontend.js harness/score/research-scorer.js harness/score/squelch-derive.js harness/tags/events.js; do wc -l "$f"; done`. Note any that need a follow-up split.
- [ ] **Step 3: Full suite + negative check (throwaway).** `npm test` green. Then TEMPORARILY corrupt one block (e.g. set a `tested-by` to a missing file), run `node scripts/generate-scorer-registry.js`, confirm it FAILS, then `git checkout` the file (do NOT commit the corruption). This proves acceptance §11.2.
- [ ] **Step 4: Whole-branch review.** Run `superpowers:requesting-code-review` over the phase range; feed it the byte-identity gate results and the size audit. Address findings.
- [ ] **Step 5: Commit** `docs(scorer): final registry + inventory regen`.

---

## Self-Review

- **Spec coverage:** §3 taxonomy → B1 blocks; §4 schema → A1 parser; §5 six checks → A1 `check()` + D1 negative check; §6 map → B1 table + C1–C5; §7 fusion/join-row + de-closure → C4; §8 testing (per-core + byte-identity + equivalence + generator) → A1/A4/C*; §8 CI-fixture → A3/A4; §9 phases → A/B/C/D; §10 size → B/C + D1 audit; §11 acceptance 1–9 → A1(2,5,6), A4(4,7), C*(3), D1(8,9); §12 rollback → Phase C exit gate. No uncovered requirement.
- **Placeholder scan:** the B1 per-module table is data (exact field values), not a placeholder; carve steps give exact source constructs + new signatures (the bodies exist in-repo and are byte-identity-gated — reproducing them verbatim would risk transcription drift). No TODO/TBD.
- **Type consistency:** `kalmanStep(state,fix)->{state,out}`, `buildWindows(wavBytes,audioFirstFrameMs)->{samples,sr,sp1,frames}`, `scoreWindow(window,floors,weights)->row`, `joinWindows(chaosSeries,scoredWindows,floors)->rows`, `valueFor(name,event,ctx)`, `reliabilityFor(name,event,ctx)`, `chaosThreshold(series)->thr`, `seedWindow(row,thr)->bool`, `segmentEvents(rows,seedFn,opts)->events[]` — used consistently between each task's Interfaces block and its steps.
