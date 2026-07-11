// tests/lib/fixtures.js
// Guard for NON-hermetic tests that read large / gitignored capture fixtures — data/*.wav,
// out/score-jc4/*, .superpowers/sdd/task*-ref/* — which are deliberately not committed. Those
// fixtures are present on a dev machine (so the tests run in full locally), but absent in CI (so
// the tests SKIP honestly instead of erroring). Hermetic tests never need this.
"use strict";
const fs = require("fs");

// true only if every path exists.
function have() {
  for (let i = 0; i < arguments.length; i++) {
    if (!fs.existsSync(arguments[i])) return false;
  }
  return true;
}

// Print a visible, honest skip line (NOT "passed").
function skipped(name, detail) {
  console.log(name + " SKIPPED (no local fixture" + (detail ? ": " + detail : "") + ")");
}

module.exports = { have, skipped };
