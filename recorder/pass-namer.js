// recorder/pass-namer.js
// Pure default-filename numbering for the capture page: pick the lowest "Pass-N" not yet used.
// @unit-begin
// unit:        pass-namer
// causality:   pure
// state:       none
// mutates:     none
// contract:    passName(n) -> "Pass-<n>" · parsePassNumber(name) -> number>=1|null · nextUnused(used[]) -> number>=1
// deps:        —
// realtime:    reuse-as-is
// tested-by:   tests/pass-namer.test.js
// @unit-end
// NOTE: this is a recorder/ unit, so scripts/generate-scorer-registry.js (which scans harness/** only)
// does not enforce this block; it documents the unit per docs/scorer-frontmatter-standard.md. All side
// effects (localStorage, the input value, downloads) live in capture.js — the imperative shell.
"use strict";

// Canonical name for pass number n.
function passName(n) {
  return "Pass-" + n;
}

// The pass number of a canonical "Pass-<n>" name (positive, no leading zero), else null. A custom name
// the user typed returns null, so it never consumes a numeral.
function parsePassNumber(name) {
  const m = /^Pass-([1-9]\d*)$/.exec(name);
  return m ? Number(m[1]) : null;
}

// Lowest positive integer not present in `used` (an array of numbers). Non-positive entries are ignored.
// Pure: does not mutate `used`.
function nextUnused(used) {
  const seen = new Set(used);
  let n = 1;
  while (seen.has(n)) { n += 1; }
  return n;
}

// Block-scope `exported` so multiple recorder modules loaded as classic <script> tags in one global
// scope don't collide (each `const exported`).
{
  const exported = { passName, parsePassNumber, nextUnused };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
}
