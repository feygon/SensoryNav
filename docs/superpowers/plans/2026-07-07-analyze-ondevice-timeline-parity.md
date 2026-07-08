# Analyze page — on-device timeline parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `analyze.html` reproduce the `timeline-jc4.html` stacked timeline (speed + roughness + folded sub-bass + low/mid/high bands + tags, all toggles/hover/zoom/localhost-audio) computed **on-device** in a Web Worker from the dropped `.wav` + `.json`.

**Architecture:** Reuse, don't rebuild. (1) *Extract* the timeline renderer (`chartClient`+`buildData`) out of `scripts/plot-timeline.js` into a shared `timeline-render.js` (the exact move that produced `ribbon-render.js`). (2) *Extract* the derivation logic that today writes the timeline's `*-clean.json` — which lives in `scripts/score-research.js` and `scripts/squelch-extract.js` — into worker-callable modules, behind a **shared front-end** (decode + SP1 windows + SP2 track computed once). (3) The worker runs those modules and posts `{scored,hires,squelch,tags}` to the renderer. No numbers are recomputed by a second, divergent path.

**Tech Stack:** Vanilla JS (no deps), Node `assert` test scripts, dual CommonJS/`self.SensoryNav*` export pattern, Web Worker `importScripts`, SVG rendering.

## Global Constraints

- **No new dependencies** — vanilla JS only; if any package is ever proposed, the secure-installer gate applies. (spec §4; project `CLAUDE.md`)
- **Reuse-before-build** — extract shared code; never fork a second copy. Regenerate `docs/viz-architecture.md` after adding a reusable module. (spec §4; `CLAUDE.md`)
- **Dual export tail** on every browser/worker module: block-scoped `exported`; `if (typeof module !== "undefined" && module.exports) module.exports = exported;` and `if (typeof self !== "undefined") self.SensoryNavX = Object.assign(self.SensoryNavX || {}, exported);` (use `self`, not `window`, so it works in a Worker). (spec §4)
- **Byte-identical / numeric-identity** — the renderer extraction preserves `chartClient` verbatim; the scorer extractions must leave `out/score-jc4/*-clean.json` unchanged. (spec §8)
- **Privacy** — audio is decoded/scored in memory then discarded; never written to disk, never uploaded. Audio playback is **localhost-only** via an in-memory object-URL (`isLocal` gate). This cycle persists nothing new. (spec §6)
- **Dark mode, no pure-white surfaces** — `analyze.html` is already dark-mode; the reused timeline markup + `timeline.css` are dark by default. Bump `?v=` on shared theme assets if touched. (`CLAUDE.md`)
- **Function size** — new extracted scorer modules decompose into ≤100-line named functions (≤300 is a hard block). The moved `chartClient` (~600 lines) is the one exception: preserved verbatim for parity; its decomposition is a separate follow-up. (spec §4)
- **Budget** (target: Samsung Galaxy A16, Chrome, HTTPS): transfer the WAV `ArrayBuffer` (no main-thread copy); free the raw WAV bytes after decode; peak worker memory ≤ ~500 MB; scoring ≤ ~15 s for a 10-min capture; page never freezes. (spec §3)

**Verification target artifacts:** `out/score-jc4/{scored-clean,highres-clean,squelch-clean,tags-clean}.json`, generated from `data/johnson-creek-pass-4-181806.json` (+ its `.wav`).

---

## File Structure

**Create**
- `timeline-render.js` (repo root) — the ONE timeline renderer. IIFE exposing `self.SensoryNavTimeline = { buildData, chartClient, drawTimeline }` (+ `module.exports`). Moved verbatim from `plot-timeline.js`.
- `harness/score/score-frontend.js` — shared front-end: `buildFrontEnd(input)` → `{ samples, sr, sp1, frames, sp2, sp2By }` (decode + SP1 `framesToWindows`/`stft` + SP2 `buildMotionTrack`), computed once.
- `harness/score/speech-detect.js` — `detectSpeech(frames, sr)` → `{ speechCount, isTalking, speechRanges }` (the talking detector, extracted from `score-research.js`).
- `harness/score/research-scorer.js` — `scoreResearch(front, opts)` → `{ scored, hires }` (RW reweight, baseline A talking-excluded, roughness raw/db, floor arrays). Pure; no `fs`/`argv`.
- `harness/score/squelch-derive.js` — `deriveSquelch(front, samples, sr, opts)` → `{ squelch, tags }` (spectral chaos, baseline B sub-bass-inclusive, sub-bass floor, events, tags). Pure; no `fs`/`argv`.
- Tests: `tests/score-frontend.test.js`, `tests/speech-detect.test.js`, `tests/research-scorer.test.js`, `tests/squelch-derive.test.js`, `tests/timeline-render.test.js`.

**Modify**
- `scripts/plot-timeline.js` — shell that loads `timeline-render.js` (stop embedding `chartClient`/`buildData` source); copy `timeline-render.js` + `timeline.css` next to output.
- `scripts/score-research.js` — thin I/O wrapper: read files → `buildFrontEnd` → `detectSpeech` → `scoreResearch` → write the two `*-clean.json` (output unchanged).
- `scripts/squelch-extract.js` — thin I/O wrapper: read files → `buildFrontEnd` → `deriveSquelch` → write the two `*-clean.json` (output unchanged).
- Dual-export tails: `harness/audio/{audio-windows,fft}.js`, `harness/motion/{motion-track,kalman-smoother,geo-project,linalg}.js`, `harness/score/{reliability,roughness-db,validate}.js`, `harness/tags/{events,extract,schema}.js`. (`wav-decoder`, `baseline`, `metrics`, `spectral-chaos` already have it.)
- `harness/audio/load-pass.js` — split file-read from pure windowing so a worker can feed an ArrayBuffer.
- `analyze-worker.js` — `importScripts` the harness deps + the four new modules; run front-end once; post `{scored,hires,squelch,tags}`.
- `analyze.html` — link `timeline.css`; load `timeline-render.js`; add the toolbar + `#chartwrap`/`#chart`/`#tt` + Legend/Glossary markup from the generator shell.
- `analyze.js` — on worker message call `SensoryNavTimeline.drawTimeline`; wire the localhost object-URL audio.
- `.github/workflows/deploy-pages.yml` — add `timeline-render.js`, `timeline.css`, and the new `harness/score/*` modules to the allowlist.
- `docs/viz-architecture.md` — regenerate.

---

## Phase 1 — Renderer extraction (byte-identical)

### Task 1: Extract `timeline-render.js`; make `plot-timeline.js` a shell

**Files:**
- Create: `timeline-render.js`
- Create: `tests/timeline-render.test.js`
- Modify: `scripts/plot-timeline.js` (remove embedded `chartClient`/`buildData`; emit shell; copy assets)

**Interfaces:**
- Produces: `self.SensoryNavTimeline = { buildData(sources,cfg), chartClient(data), drawTimeline(sources,cfg) }` where `drawTimeline = (s,c) => chartClient(buildData(s,c))`. Same DOM-ID contract as today (`#chart`, `#range`, `#play`, `#bands`, `#roughmode`, `#smooth`/`#smoothctl`/`#smoothval`, `#tt`, `#chartwrap`, `#reset`, `#satpct`). Also `module.exports` the same object for Node.

- [ ] **Step 1: Create `timeline-render.js` by moving the two functions verbatim.**
  Copy the **exact** bodies of `buildData` (currently `plot-timeline.js` lines ~45–102) and `chartClient` (lines ~105–774) into a new IIFE. Do not edit a single character of their logic. Wrap:
```js
// timeline-render.js — the ONE stacked-timeline renderer. Used by BOTH scripts/plot-timeline.js
// (out/score/timeline-*.html) and analyze.html, so the two are byte-identical. Reads the pipeline's
// scored/hires/squelch/tags data objects and renders the SVG panels + toolbar interactions.
// drawTimeline(sources, cfg) = chartClient(buildData(sources, cfg)); relies on the page providing
// the toolbar/#chart/#tt DOM (see analyze.html / the generator shell).
(function () {
  "use strict";
  function buildData(sources, cfg) { /* …verbatim… */ }
  function chartClient(D) { /* …verbatim… */ }
  function drawTimeline(sources, cfg) { return chartClient(buildData(sources, cfg)); }
  const exported = { buildData, chartClient, drawTimeline };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavTimeline = Object.assign(self.SensoryNavTimeline || {}, exported); }
}());
```
  `buildData` touches `document.getElementById("satpct")` — that line is already guarded (`if (sp) …`) so it is Node-safe. Leave it verbatim.

- [ ] **Step 2: Write the Node smoke test.**
```js
// tests/timeline-render.test.js
"use strict";
const assert = require("assert");
const T = require("../timeline-render.js");
assert.strictEqual(typeof T.buildData, "function", "buildData exported");
assert.strictEqual(typeof T.chartClient, "function", "chartClient exported");
assert.strictEqual(typeof T.drawTimeline, "function", "drawTimeline exported");
// buildData is DOM-light enough to run headless on a minimal fixture:
global.document = { getElementById: () => null };
const scored = [
  { started_at_ms: 0, speed_mps: 0, roughness_raw: 0, roughness_db: 0 },
  { started_at_ms: 1000, speed_mps: 10, roughness_raw: 50, roughness_db: 8 }
];
const D = T.buildData({ scored }, { label: "t", audioUrl: null, bandsOn: false, envelopeOn: false });
assert.strictEqual(D.pts.length, 2, "two points");
assert.strictEqual(D.maxT, 1, "maxT seconds");
assert.strictEqual(D.label, "t");
delete global.document;
console.log("timeline-render.test.js OK");
```

- [ ] **Step 3: Run it to verify it fails (module not yet present at import if Step 1 skipped, or passes if done).**
  Run: `node tests/timeline-render.test.js`
  Expected before Step 1: FAIL `Cannot find module '../timeline-render.js'`. After Step 1: PASS `timeline-render.test.js OK`.

- [ ] **Step 4: Rewrite `plot-timeline.js` to a shell.** Delete the inline `function buildData(...)` and `function chartClient(...)` definitions. In the emitted HTML `<script>`, replace `var chartClient = (${chartClient.toString()}); var buildData = (${buildData.toString()});` and the `chartClient(buildData(s, CFG))` call with a reference to the external module:
```js
// in the generated shell <head>: <script src="timeline-render.js"></script>
// in the bootstrap: SensoryNavTimeline.drawTimeline(s, CFG)   // s = fetched {scored,hires,squelch,tags}
```
  After `fs.writeFileSync(outPath, html)` and the existing `timeline.css` copy, add:
```js
fs.copyFileSync(path.join(__dirname, "..", "timeline-render.js"), path.join(path.dirname(outPath) || ".", "timeline-render.js"));
```

- [ ] **Step 5: Regenerate the JC4 timeline and confirm it renders.**
  Run: `node scripts/plot-timeline.js out/score-jc4/scored-clean.json out/score/timeline-jc4.html JC4 /data/johnson-creek-pass-4-181806.wav out/score-jc4/highres-clean.json bands envelope squelch=out/score-jc4/squelch-clean.json tags=out/score-jc4/tags-clean.json`
  (Use the exact args the current `timeline-jc4.html` was built with — recover them from `console.log`/git if they differ.)
  Expected: writes `timeline-jc4.html` + `timeline.css` + `timeline-render.js`. Then serve and eyeball: `node scripts/serve-out.js` → open `http://localhost:8137/out/score/timeline-jc4.html`. **Manual parity check** (no headless-DOM harness exists): panels, dB toggle, bands, envelope, hover, zoom, tag dots, speech ribbon all identical to before.

- [ ] **Step 6: Full suite green.**
  Run: `npm test`
  Expected: all pass (new `timeline-render.test.js` will be added to the runner in Step 7).

- [ ] **Step 7: Register the test + commit.**
  Add `&& node tests/timeline-render.test.js` to `package.json`'s `test` script.
```bash
git add timeline-render.js tests/timeline-render.test.js scripts/plot-timeline.js package.json out/score/timeline-jc4.html out/score/timeline.css out/score/timeline-render.js
git commit -m "refactor(viz): extract timeline-render.js from plot-timeline.js (shared renderer)"
```

---

## Phase 2 — Harness dual-export ports (each keeps the suite green)

> Each task appends the block-scoped dual-export tail to modules that are currently Node-only, so a Worker can `importScripts` them. The **existing** per-module test proves behavior is unchanged; `tests/browser-scope.test.js` proves the `self` global attaches. If `browser-scope.test.js` enumerates the expected globals, extend it; otherwise add a focused assertion as shown.

### Task 2: Port SP1 audio front-end (`audio-windows`, `fft`) + split `load-pass`

**Files:**
- Modify: `harness/audio/audio-windows.js`, `harness/audio/fft.js` (add dual-export tail)
- Modify: `harness/audio/load-pass.js` (split I/O from windowing)
- Test: `tests/audio-windows.test.js`, `tests/fft.test.js`, `tests/load-pass.test.js` (existing), `tests/browser-scope.test.js`

**Interfaces:**
- Produces: `self.SensoryNavScore.{ framesToWindows, stft }` (audio-windows), `self.SensoryNavScore.{ fft, … }` (fft). `load-pass` gains `windowsFromSamples(samples, sampleRate, audioFirstFrameMs) → windows` (pure), with `loadPass(wavPath, sidecarPath)` reduced to file-read + a call to it.

- [ ] **Step 1: Add the dual-export tail to `fft.js` and `audio-windows.js`.** Wrap each module's existing `module.exports = {...}` object as `const exported = {...}` inside a block, then:
```js
{
  const exported = { /* existing exports, unchanged */ };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
```

- [ ] **Step 2: Split `load-pass.js`.** Extract the pure part (everything after the file read that turns `samples` into `windows`) into `windowsFromSamples(samples, sampleRate, audioFirstFrameMs)`. `loadPass` keeps reading the WAV/sidecar and calls it. Export both. Add the dual-export tail.

- [ ] **Step 3: Add a browser-scope assertion.** In `tests/browser-scope.test.js`, add (matching its existing style):
```js
global.self = global.self || {};
require("../harness/audio/fft.js");
require("../harness/audio/audio-windows.js");
assert.strictEqual(typeof self.SensoryNavScore.stft, "function", "stft on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.framesToWindows, "function", "framesToWindows on self.SensoryNavScore");
```

- [ ] **Step 4: Run tests.**
  Run: `node tests/fft.test.js && node tests/audio-windows.test.js && node tests/load-pass.test.js && node tests/browser-scope.test.js`
  Expected: all PASS (behavior unchanged; globals attached).

- [ ] **Step 5: Commit.**
```bash
git add harness/audio/fft.js harness/audio/audio-windows.js harness/audio/load-pass.js tests/browser-scope.test.js
git commit -m "feat(harness): dual-export SP1 audio front-end + split load-pass I/O"
```

### Task 3: Port SP2 motion track (`motion-track`, `kalman-smoother`, `geo-project`, `linalg`)

**Files:**
- Modify: `harness/motion/{motion-track,kalman-smoother,geo-project,linalg}.js` (dual-export tail)
- Test: existing `tests/{motion-track,kalman-smoother,geo-project,linalg}.test.js`, `tests/browser-scope.test.js`

**Interfaces:**
- Produces: `self.SensoryNavScore.buildMotionTrack` (+ the helper exports each module already has), available in a Worker.

- [ ] **Step 1: Add the dual-export tail** (same block-scoped pattern as Task 2, Step 1) to all four modules. Keep each module's existing exports identical.

- [ ] **Step 2: Browser-scope assertion.** In `tests/browser-scope.test.js`:
```js
require("../harness/motion/motion-track.js");
assert.strictEqual(typeof self.SensoryNavScore.buildMotionTrack, "function", "buildMotionTrack on self.SensoryNavScore");
```

- [ ] **Step 3: Run tests.**
  Run: `node tests/linalg.test.js && node tests/geo-project.test.js && node tests/kalman-smoother.test.js && node tests/motion-track.test.js && node tests/browser-scope.test.js`
  Expected: all PASS.

- [ ] **Step 4: Commit.**
```bash
git add harness/motion tests/browser-scope.test.js
git commit -m "feat(harness): dual-export SP2 motion track for worker use"
```

### Task 4: Port score modules (`reliability`, `roughness-db`, `validate`)

**Files:**
- Modify: `harness/score/{reliability,roughness-db,validate}.js` (dual-export tail)
- Test: existing `tests/score-{reliability,roughness-db,validate}.test.js`, `tests/browser-scope.test.js`

**Interfaces:**
- Produces: `self.SensoryNavScore.{ windowReliability, roughnessDb, toDb, validateBatch }`.

- [ ] **Step 1: Add the dual-export tail** to all three modules.

- [ ] **Step 2: Browser-scope assertion.**
```js
require("../harness/score/roughness-db.js");
require("../harness/score/reliability.js");
require("../harness/score/validate.js");
assert.strictEqual(typeof self.SensoryNavScore.roughnessDb, "function", "roughnessDb on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.windowReliability, "function", "windowReliability on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.validateBatch, "function", "validateBatch on self.SensoryNavScore");
```

- [ ] **Step 3: Run tests.**
  Run: `node tests/score-reliability.test.js && node tests/score-roughness-db.test.js && node tests/score-validate.test.js && node tests/browser-scope.test.js`
  Expected: all PASS.

- [ ] **Step 4: Commit.**
```bash
git add harness/score/reliability.js harness/score/roughness-db.js harness/score/validate.js tests/browser-scope.test.js
git commit -m "feat(harness): dual-export reliability/roughness-db/validate for worker use"
```

### Task 5: Port tags (`events`, `extract`, `schema`)

**Files:**
- Modify: `harness/tags/{events,extract,schema}.js` (dual-export tail)
- Test: existing `tests/tags-{events,extract,schema}.test.js`, `tests/browser-scope.test.js`

**Interfaces:**
- Produces: `self.SensoryNavScore.{ detectEvents, extractTags, loadRegistry }`.

- [ ] **Step 1: Add the dual-export tail** to all three modules. `loadRegistry` must not depend on `fs` at call time in the worker — if it reads a registry file, change it to accept an already-parsed registry object (the wrapper/worker passes it). Confirm the current signature; if it reads from disk, add `loadRegistry(registryObjOrPath)` that passes through an object unchanged.

- [ ] **Step 2: Browser-scope assertion.**
```js
require("../harness/tags/events.js");
require("../harness/tags/extract.js");
require("../harness/tags/schema.js");
assert.strictEqual(typeof self.SensoryNavScore.detectEvents, "function", "detectEvents on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.extractTags, "function", "extractTags on self.SensoryNavScore");
```

- [ ] **Step 3: Run tests.**
  Run: `node tests/tags-schema.test.js && node tests/tags-events.test.js && node tests/tags-extract.test.js && node tests/browser-scope.test.js`
  Expected: all PASS.

- [ ] **Step 4: Commit.**
```bash
git add harness/tags tests/browser-scope.test.js
git commit -m "feat(harness): dual-export tags events/extract/schema for worker use"
```

---

## Phase 3 — Shared front-end + derivation extractions (numeric-identity gated)

> The gate for Tasks 8–9 is: after moving the math into modules and reducing the scripts to thin wrappers, re-running them leaves `out/score-jc4/*-clean.json` **byte-identical**. First, snapshot the current outputs as the reference.

### Task 6: Shared front-end module (`score-frontend.js`)

**Files:**
- Create: `harness/score/score-frontend.js`
- Create: `tests/score-frontend.test.js`
- Reference snapshot: `out/score-jc4/*-clean.json` must exist (regenerate via the two scripts if missing).

**Interfaces:**
- Consumes: `decodeWav` (wav-decoder), `framesToWindows`/`stft` (audio-windows), `buildMotionTrack` (motion-track).
- Produces: `buildFrontEnd({ wavBytes, sampleRate?, samples?, audioFirstFrameMs, gpsSamples }) → { samples, sr, sp1, frames, sp2, sp2By }`. Accepts either raw `wavBytes` (Uint8Array/ArrayBuffer → `decodeWav`) or pre-decoded `samples`+`sampleRate`. `sp2By` is a `Map<window_id, track-row>`.

- [ ] **Step 1: Write the failing test** using the real pass fixture.
```js
// tests/score-frontend.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const f = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
assert.ok(f.sp1.length > 100, "sp1 windows built");
assert.ok(f.frames.length > f.sp1.length, "stft frames built (finer than 1s windows)");
assert.strictEqual(f.sp2.length, f.sp1.length, "sp2 track aligns to sp1 windows");
assert.ok(f.sp2By.get(f.sp1[0].window_id), "sp2By indexed by window_id");
console.log("score-frontend.test.js OK");
```

- [ ] **Step 2: Run to verify it fails.**
  Run: `node tests/score-frontend.test.js`
  Expected: FAIL `Cannot find module '../harness/score/score-frontend.js'`.

- [ ] **Step 3: Implement `score-frontend.js`** by lifting the shared prelude both scripts share today (decode → `framesToWindows` → `stft` → `buildMotionTrack` → `sp2By` map). Keep the `require`/`self` dual-import guard so it runs in Node and the Worker:
```js
"use strict";
var S = (typeof require !== "undefined") ? {
  decodeWav: require("../audio/wav-decoder").decodeWav,
  framesToWindows: require("../audio/audio-windows").framesToWindows,
  stft: require("../audio/audio-windows").stft,
  buildMotionTrack: require("../motion/motion-track").buildMotionTrack
} : self.SensoryNavScore;
function buildFrontEnd(input) {
  var dec = input.samples != null
    ? { samples: input.samples, sampleRate: input.sampleRate }
    : S.decodeWav(input.wavBytes);
  var sr = dec.sampleRate;
  var sp1 = S.framesToWindows(dec.samples, sr, input.audioFirstFrameMs);
  var frames = S.stft(dec.samples, sr);
  var sp2 = S.buildMotionTrack(input.gpsSamples, sp1.map(function (w) { return { window_id: w.window_id, started_at_ms: w.started_at_ms }; }), {});
  var sp2By = new Map(); sp2.forEach(function (r) { sp2By.set(r.window_id, r); });
  return { samples: dec.samples, sr: sr, sp1: sp1, frames: frames, sp2: sp2, sp2By: sp2By };
}
{ const exported = { buildFrontEnd };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); } }
```

- [ ] **Step 4: Run to verify it passes.**
  Run: `node tests/score-frontend.test.js`
  Expected: PASS `score-frontend.test.js OK`.

- [ ] **Step 5: Register test + commit.** Append `&& node tests/score-frontend.test.js` to `package.json`.
```bash
git add harness/score/score-frontend.js tests/score-frontend.test.js package.json
git commit -m "feat(score): shared decode+SP1+SP2 front-end for on-device scoring"
```

### Task 7: Speech detector module (`speech-detect.js`)

**Files:**
- Create: `harness/score/speech-detect.js`
- Create: `tests/speech-detect.test.js`

**Interfaces:**
- Consumes: `toDb` (roughness-db) for the band-energy → dB test.
- Produces: `detectSpeech(frames, sr) → { speechCount, isTalking(i), speechRanges }` where `isTalking(windowIndex)` matches `score-research.js`'s inline logic exactly (`dB(high) > -40 && dB(mid) > -35`, `>= 3` frames/sec), and `speechRanges` is the merged `[[startSec,endSec],…]` used for `hires.speech`.

- [ ] **Step 1: Write the failing test.**
```js
// tests/speech-detect.test.js
"use strict";
const assert = require("assert");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const sr = 48000;
// two frames in window 0 with high+mid above thresholds → talking; window 1 silent → not.
const loud = { centerSample: 0, energies: { low: 1, mid: 1, high: 1 } };
const frames = [loud, { centerSample: 10, energies: { low: 1, mid: 1, high: 1 } }, { centerSample: 20, energies: { low: 1, mid: 1, high: 1 } },
  { centerSample: sr * 1.5, energies: { low: 1e-12, mid: 1e-12, high: 1e-12 } }];
const d = detectSpeech(frames, sr);
assert.strictEqual(d.isTalking(0), true, "window 0 talking (>=3 co-elevated frames)");
assert.strictEqual(d.isTalking(1), false, "window 1 not talking");
console.log("speech-detect.test.js OK");
```

- [ ] **Step 2: Run to verify it fails.**
  Run: `node tests/speech-detect.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `speech-detect.js`** by lifting `HI/MID/SPEECH_FRAMES`, the `speechCount` loop, `isTalking`, and the `speechRanges` merge (the `flagged`→`speech` loop) from `score-research.js` verbatim. Dual-export tail. Use `toDb` from roughness-db for `dB`.

- [ ] **Step 4: Run to verify it passes.**
  Run: `node tests/speech-detect.test.js` → PASS.

- [ ] **Step 5: Register test + commit.**
```bash
git add harness/score/speech-detect.js tests/speech-detect.test.js package.json
git commit -m "feat(score): extract talking/speech detector (feeds baseline exclusion + speech ribbon)"
```

### Task 8: Extract `research-scorer.js`; make `score-research.js` a wrapper

**Files:**
- Create: `harness/score/research-scorer.js`
- Create: `tests/research-scorer.test.js`
- Modify: `scripts/score-research.js` (thin wrapper)

**Interfaces:**
- Consumes: `buildFrontEnd` (Task 6), `detectSpeech` (Task 7), `fitBaseline`/`floorAt`/`globalFloorAt`/`baselineMeta` (baseline), `windowReliability`, `roughnessDb`/`toDb`, `validateBatch`, `CONSTANTS`.
- Produces: `scoreResearch(front, opts) → { scored, hires }`, where `scored` and `hires` are the exact objects `score-research.js` writes to `scored-clean.json` and `highres-clean.json` today (§5 shapes). `opts` carries `{ RW, OVERLAP_TIERS, SCORE_SCALE, DETECT_TAU }` with the current defaults.

- [ ] **Step 1: Snapshot the reference outputs** (if not already committed).
  Run: `node scripts/score-research.js data/johnson-creek-pass-4-181806.json out/score-jc4`
  Then: `git stash -u 2>/dev/null; git status --short out/score-jc4` — ensure `scored-clean.json` + `highres-clean.json` are committed as the reference (commit them if untracked).

- [ ] **Step 2: Write the failing byte-identity test.**
```js
// tests/research-scorer.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const { scoreResearch } = require("../harness/score/research-scorer.js");
const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored, hires } = scoreResearch(Object.assign({}, front, { speech }), {});
const refScored = JSON.parse(fs.readFileSync("out/score-jc4/scored-clean.json", "utf8"));
const refHires = JSON.parse(fs.readFileSync("out/score-jc4/highres-clean.json", "utf8"));
assert.strictEqual(JSON.stringify(scored, null, 2), JSON.stringify(refScored, null, 2), "scored-clean identical");
assert.strictEqual(JSON.stringify(hires), JSON.stringify(refHires), "highres-clean identical");
console.log("research-scorer.test.js OK");
```

- [ ] **Step 3: Run to verify it fails.**
  Run: `node tests/research-scorer.test.js` → FAIL (module missing).

- [ ] **Step 4: Implement `research-scorer.js`** by moving the derivation from `score-research.js` verbatim: the `RW` reweight, talking-excluded baseline-sample build (`reliability = 0` when `speech.isTalking(i)`), `fitBaseline(samples, { OVERLAP_TIERS: [[10,0.25],[5,0.50]] })`, `roughLinear`/`roughDbCalc`, the `scored` map, and the hires frame loop producing `{ t0,dt,r,rdb,lo,mi,hi,floLo,floMi,floHi,speech }`. Take `front` (from `buildFrontEnd`) + `front.speech` as inputs instead of recomputing them. No `fs`/`argv`. Dual-export tail. Decompose into named helpers (`baselineSamples`, `scoreWindow`, `hiresTrace`) to respect the ≤100-line rule.

- [ ] **Step 5: Run to verify it passes.**
  Run: `node tests/research-scorer.test.js` → PASS.

- [ ] **Step 6: Reduce `score-research.js` to a wrapper** that reads the sidecar/WAV, calls `buildFrontEnd` → `detectSpeech` → `scoreResearch`, then writes `scored-clean.json` + `highres-clean.json` and logs the same summary. Re-run and diff:
  Run: `node scripts/score-research.js data/johnson-creek-pass-4-181806.json out/score-jc4 && git diff --exit-code out/score-jc4/scored-clean.json out/score-jc4/highres-clean.json`
  Expected: exit 0 (no change) — the output is byte-identical.

- [ ] **Step 7: Register test + commit.**
```bash
git add harness/score/research-scorer.js tests/research-scorer.test.js scripts/score-research.js package.json
git commit -m "refactor(score): extract research-scorer.js; score-research.js becomes a thin wrapper"
```

### Task 9: Extract `squelch-derive.js`; make `squelch-extract.js` a wrapper

**Files:**
- Create: `harness/score/squelch-derive.js`
- Create: `tests/squelch-derive.test.js`
- Modify: `scripts/squelch-extract.js` (thin wrapper)

**Interfaces:**
- Consumes: `buildFrontEnd`, `computeSpectralChaos` (spectral-chaos), `fitBaseline`/`floorAt`, `windowReliability`, `detectEvents`, `extractTags`, `loadRegistry`.
- Produces: `deriveSquelch(front, samples, sr, opts) → { squelch, tags }` — exactly the objects `squelch-extract.js` writes to `squelch-clean.json` and `tags-clean.json` today (§5 shapes, incl. `subbass_floor`).

- [ ] **Step 1: Write the failing byte-identity test** (mirrors Task 8, Step 2, against `squelch-clean.json` + `tags-clean.json`).
```js
// tests/squelch-derive.test.js
"use strict";
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { deriveSquelch } = require("../harness/score/squelch-derive.js");
const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const registry = JSON.parse(fs.readFileSync("harness/tags/registry.json", "utf8")); // adjust to actual registry path
const { squelch, tags } = deriveSquelch(front, front.samples, front.sr, { registry });
assert.strictEqual(JSON.stringify(squelch), fs.readFileSync("out/score-jc4/squelch-clean.json", "utf8"), "squelch-clean identical");
assert.strictEqual(JSON.stringify(tags), fs.readFileSync("out/score-jc4/tags-clean.json", "utf8"), "tags-clean identical");
console.log("squelch-derive.test.js OK");
```
  (Confirm the exact registry path/loader `squelch-extract.js` uses and the exact `JSON.stringify` spacing each output is written with; match it precisely so the string compare holds.)

- [ ] **Step 2: Run to verify it fails.**
  Run: `node tests/squelch-derive.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `squelch-derive.js`** by moving the derivation from `squelch-extract.js` verbatim: `computeSpectralChaos`, `nearestIndex` joins, `buildScoredWindows`, baseline B fit, `computeSubbassFloor`, `detectEvents` + `extractTags` (per-tag value/confidence, near-silence guard). Take `front` as input (don't re-decode/re-window). No `fs`/`argv`. Dual-export tail. Decompose to respect the ≤100-line rule.

- [ ] **Step 4: Run to verify it passes.**
  Run: `node tests/squelch-derive.test.js` → PASS.

- [ ] **Step 5: Reduce `squelch-extract.js` to a wrapper**; re-run and diff:
  Run: `node scripts/squelch-extract.js data/johnson-creek-pass-4-181806.json out/score-jc4 && git diff --exit-code out/score-jc4/squelch-clean.json out/score-jc4/tags-clean.json`
  Expected: exit 0 (byte-identical).

- [ ] **Step 6: Register test + commit.**
```bash
git add harness/score/squelch-derive.js tests/squelch-derive.test.js scripts/squelch-extract.js package.json
git commit -m "refactor(score): extract squelch-derive.js; squelch-extract.js becomes a thin wrapper"
```

---

## Phase 4 — On-device wiring

### Task 10: `analyze-worker.js` — full on-device pipeline

**Files:**
- Modify: `analyze-worker.js`
- Test: manual (worker; verified end-to-end in Task 12) + a Node harness test that imports the modules the worker loads and asserts the four products match the reference (reuses Tasks 8–9 fixtures).

**Interfaces:**
- Consumes: all Phase 2/3 modules via `importScripts` (paths relative to the worker URL, matching the deploy layout — `harness/audio/…`, `harness/motion/…`, `harness/score/…`, `harness/tags/…`).
- Produces: `postMessage({ ok, scored, hires, squelch, tags })` or `{ ok:false, error }`.

- [ ] **Step 1: Rewrite `analyze-worker.js`.**
```js
"use strict";
importScripts(
  "harness/audio/wav-decoder.js", "harness/audio/fft.js", "harness/audio/audio-windows.js",
  "harness/motion/linalg.js", "harness/motion/geo-project.js", "harness/motion/kalman-smoother.js", "harness/motion/motion-track.js",
  "harness/score/baseline.js", "harness/score/reliability.js", "harness/score/roughness-db.js", "harness/score/validate.js",
  "harness/score/spectral-chaos.js", "harness/tags/schema.js", "harness/tags/events.js", "harness/tags/extract.js",
  "harness/score/score-frontend.js", "harness/score/speech-detect.js", "harness/score/research-scorer.js", "harness/score/squelch-derive.js"
);
self.onmessage = function (e) {
  try {
    const S = self.SensoryNavScore;
    const { wav, sidecar, registry } = e.data;             // wav: transferred ArrayBuffer
    const front = S.buildFrontEnd({ wavBytes: new Uint8Array(wav), audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
    const speech = S.detectSpeech(front.frames, front.sr);
    const { scored, hires } = S.scoreResearch(Object.assign({}, front, { speech }), {});
    const { squelch, tags } = S.deriveSquelch(front, front.samples, front.sr, { registry });
    self.postMessage({ ok: true, scored, hires, squelch, tags });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
```
  If the tag registry is a static JSON, inline it into the worker (or `importScripts` a small `harness/tags/registry.js` that assigns `self.SensoryNavScore.REGISTRY`) rather than fetching — keep everything local.

- [ ] **Step 2: Node harness test** — assert the worker's module chain, run outside a Worker, reproduces the reference four products (compose Tasks 6–9 exactly as the worker does).
```js
// tests/analyze-pipeline.test.js  (Node stand-in for the worker's module composition)
"use strict";
const assert = require("assert"); const fs = require("fs"); const path = require("path");
const F = require("../harness/score/score-frontend.js"), Sp = require("../harness/score/speech-detect.js");
const R = require("../harness/score/research-scorer.js"), Q = require("../harness/score/squelch-derive.js");
const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = F.buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = Sp.detectSpeech(front.frames, front.sr);
const { scored } = R.scoreResearch(Object.assign({}, front, { speech }), {});
assert.strictEqual(JSON.stringify(scored, null, 2), fs.readFileSync("out/score-jc4/scored-clean.json", "utf8"), "worker chain reproduces scored-clean");
console.log("analyze-pipeline.test.js OK");
```

- [ ] **Step 3: Run tests.**
  Run: `node tests/analyze-pipeline.test.js`
  Expected: PASS.

- [ ] **Step 4: Register test + commit.**
```bash
git add analyze-worker.js tests/analyze-pipeline.test.js package.json
git commit -m "feat(analyze): worker runs the full on-device scorer (front-end once, both derivations)"
```

### Task 11: `analyze.html` + `analyze.js` — render via the shared timeline

**Files:**
- Modify: `analyze.html`, `analyze.js`
- Test: manual (Task 12)

**Interfaces:**
- Consumes: `SensoryNavTimeline.drawTimeline(sources, cfg)` (Task 1), the worker (Task 10).

- [ ] **Step 1: `analyze.html` — add the timeline shell markup.** Keep the pipeline strip + drop zones at top (already present). After the local-read summary, add the **exact** toolbar + `#chartwrap`/`#chart`/`#tt` + Legend/Glossary markup from a generated `timeline-jc4.html` (copy verbatim so the renderer's DOM-ID contract is satisfied). In `<head>`, add `<link rel="stylesheet" href="timeline.css?v=0.2.6">` and `<script src="timeline-render.js"></script>` (before `analyze.js`). Remove the old single ribbon `#chart` section if it conflicts, or keep the ribbon as a secondary panel per spec §2 (band chaos still visible) — keep both: ribbon panel + the timeline `#chartwrap`.

- [ ] **Step 2: `analyze.js` — feed the worker output to the renderer.** Replace `showRibbon()`'s sole call with: keep the ribbon (unchanged) AND, when the worker returns, build the timeline. On drop, read both files, parse the sidecar JSON, transfer the WAV ArrayBuffer + the sidecar object to the worker:
```js
worker.postMessage({ wav: wavArrayBuffer, sidecar: sidecarObj, registry: TAG_REGISTRY }, [wavArrayBuffer]);
worker.onmessage = (ev) => {
  const d = ev.data;
  if (!d.ok) { el.analysisStatus.textContent = "Could not analyze: " + d.error; return; }
  el.analysisStatus.textContent = "";
  const label = (picked.wav && picked.wav.name) || "capture";
  const audioUrl = URL.createObjectURL(new Blob([/* the wav bytes */], { type: "audio/wav" })); // localhost-gated inside the renderer
  window.SensoryNavTimeline.drawTimeline(
    { scored: d.scored, hires: d.hires, squelch: d.squelch, tags: d.tags },
    { label, audioUrl, bandsOn: true, envelopeOn: false }
  );
};
```
  Note: the WAV ArrayBuffer is transferred (detached) to the worker, so keep a separate `Blob`/URL for playback made **before** transfer (slice a copy only if playback is needed; on non-localhost the renderer ignores `audioUrl`, so you may pass `null` off-localhost to avoid holding the bytes). Free references after render to respect the memory budget.

- [ ] **Step 3: Manual smoke.** `node scripts/serve-out.js`; open `http://localhost:8137/analyze.html`; drop `data/johnson-creek-pass-4-181806.{wav,json}`. Timeline renders; status clears.

- [ ] **Step 4: Commit.**
```bash
git add analyze.html analyze.js
git commit -m "feat(analyze): render the on-device timeline via shared SensoryNavTimeline"
```

### Task 12: Budget + full F1–F16 parity verification

**Files:**
- Modify: `analyze.js` (timing/memory instrumentation)
- Test: manual checklist (device) + timing log

- [ ] **Step 1: Instrument timing + memory.** Around the worker round-trip, log `performance.now()` deltas and (where available) `performance.memory.usedJSHeapSize`; surface "scored in N.N s" in the status line. Assert the budget: for `johnson-creek-pass-4` (~10 min), scoring completes **≤ ~15 s** and stays responsive.

- [ ] **Step 2: Parity checklist (side-by-side with `out/score/timeline-jc4.html`).** Verify each: F1 speed+roughness; F2 dB↔linear toggle; F3 folded sub-bass hue/thickness; F4 low Δ; F5 mid+high; F6 bands toggle; F7 envelope+smooth; F8 stop/rough/cruise bands; F9 tag dots + hover; F10 speech ribbon; F11 hover-inspect peak-snap; F12 zoom/pan/seek/reset; F13 reset+range; F14 localhost audio playhead-follow; F15 legend+glossary; F16 satpct.

- [ ] **Step 3: Privacy check.** Confirm no network requests carry audio (DevTools Network tab empty of the WAV); confirm off-localhost the Play button is hidden and no object-URL audio is created.

- [ ] **Step 4: Commit.**
```bash
git add analyze.js
git commit -m "feat(analyze): scoring time/memory budget check + F1-F16 parity verified"
```

---

## Phase 5 — Deploy + inventory

### Task 13: Deploy allowlist + regenerate the reuse inventory

**Files:**
- Modify: `.github/workflows/deploy-pages.yml`
- Modify (generated): `docs/viz-architecture.md`

- [ ] **Step 1: Extend the web allowlist.** In `deploy-pages.yml`, add `timeline-render.js` and `timeline.css` to the `for f in …` file loop, and add the new harness modules to the harness copy block:
```bash
mkdir -p _site/harness/audio _site/harness/motion _site/harness/score _site/harness/tags
cp src/harness/audio/{wav-decoder,fft,audio-windows,load-pass}.js _site/harness/audio/
cp src/harness/motion/{linalg,geo-project,kalman-smoother,motion-track}.js _site/harness/motion/
cp src/harness/score/{baseline,reliability,roughness-db,validate,spectral-chaos,score-frontend,speech-detect,research-scorer,squelch-derive}.js _site/harness/score/
cp src/harness/tags/{schema,events,extract}.js _site/harness/tags/
```
  Keep `timeline.css` served next to `analyze.html`. Confirm every path `analyze-worker.js` `importScripts` is copied.

- [ ] **Step 2: Regenerate the inventory.**
  Run: `node scripts/generate-viz-inventory.js`
  Expected: `docs/viz-architecture.md` now lists `timeline-render.js` (`SensoryNavTimeline`) and the new `harness/score/*` modules.

- [ ] **Step 3: Full suite green.**
  Run: `npm test`
  Expected: all pass.

- [ ] **Step 4: Commit.**
```bash
git add .github/workflows/deploy-pages.yml docs/viz-architecture.md
git commit -m "chore(deploy): ship timeline-render.js + on-device scorer modules; regen inventory"
```

---

## Self-Review

**Spec coverage** — every §2 function (F1–F17) is exercised in Task 12's checklist; F1–F16 render through the Task 1 extracted renderer fed by Tasks 6–10. §3 shared front-end → Task 6. §4 extractions → Tasks 1, 8, 9; ports → Tasks 2–5; speech detector (H1) → Task 7. §5 data contracts → the byte-identity tests in Tasks 8–9 (they assert the exact emitted shapes). §6 privacy → Task 11 Step 2 + Task 12 Step 3. §7 error handling → worker try/catch (Task 10) + existing `analyze.js` summary. §8 verification → byte-identity diffs (Tasks 8–9), decode byte-path assertion (fold into Task 6's fixture: it already decodes from `fs.readFileSync` bytes, the same Uint8Array path the worker uses), regeneration (Task 1). §3 budget → Task 12. Deploy/inventory → Task 13. **No gaps.**

**Placeholder scan** — one deliberate "adjust to the actual registry path" note in Task 9 Step 1 (the loader path must be confirmed against `squelch-extract.js`); every other step has concrete code/commands. Task 11 Step 2's WAV-blob-before-transfer detail is called out rather than hand-waved.

**Type consistency** — `buildFrontEnd → { samples, sr, sp1, frames, sp2, sp2By }` consumed identically in Tasks 7–10; `scoreResearch(front+speech, opts) → { scored, hires }` and `deriveSquelch(front, samples, sr, opts) → { squelch, tags }` match their consumers in Task 10; `SensoryNavTimeline.drawTimeline(sources, cfg)` matches Task 1's definition and Task 11's call. `self.SensoryNavScore` is the single shared global across all ported modules.
