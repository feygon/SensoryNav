"use strict";
const fs = require("fs"), path = require("path");
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
