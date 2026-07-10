// harness/tags/schema.js
// Tag registry record shape validator, plus a loader: pass an already-parsed registry object
// through unchanged (the Worker path, which can't touch fs), or read+parse every *.json in a
// directory (the Node batch-driver path).
// @unit-begin
// unit:        schema
// causality:   compose
// state:       none
// mutates:     io:fs
// contract:    validateTag(rec) -> {ok,errors}
//              loadRegistry(dirOrObj) -> registry   // object: pass-through (pure); string: reads+parses dir/*.json (io:fs)
// deps:        —
// realtime:    batch-only
// tested-by:   tests/tags-schema.test.js
// @unit-end
"use strict";
var fs = (typeof require !== "undefined") ? require("fs") : null;
var path = (typeof require !== "undefined") ? require("path") : null;
const DOMAINS = ["acoustics", "harmonics", "automotive-physics", "psychoacoustics", "mapping"];
const ACCEL = ["none", "disambiguates", "required"];
const REQUIRED = ["name", "display", "domain", "definition", "indicators", "detection", "value", "confidence", "accel_dependency", "status", "discrimination_test"];
function validateTag(r) {
  const errors = [];
  for (const f of REQUIRED) if (r[f] == null) errors.push("missing " + f);
  if (r.domain && DOMAINS.indexOf(r.domain) < 0) errors.push("bad domain " + r.domain);
  if (r.accel_dependency && ACCEL.indexOf(r.accel_dependency) < 0) errors.push("bad accel_dependency");
  if (r.indicators && !Array.isArray(r.indicators)) errors.push("indicators must be array");
  return { ok: errors.length === 0, errors };
}
function loadRegistry(dirOrObj) {
  if (dirOrObj && typeof dirOrObj === "object") return dirOrObj;
  const out = {};
  for (const f of fs.readdirSync(dirOrObj)) if (f.endsWith(".json")) { const rec = JSON.parse(fs.readFileSync(path.join(dirOrObj, f), "utf8")); out[rec.name] = rec; }
  return out;
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { validateTag, loadRegistry, DOMAINS, ACCEL };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
