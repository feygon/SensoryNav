// harness/tags/extract.js
// Fusion loop: for each tag in the registry, reads its detection value + reliability off the
// caller-supplied ctx (valueFor/reliabilityFor) and turns them into {value,confidence}.
// @unit-begin
// unit:        extract
// causality:   compose
// state:       none
// mutates:     none
// contract:    extractTags(event,ctx{registry,valueFor,reliabilityFor}) -> {tags,accel_gaps}
//              confidence(value,reliabilityFactor,accelDep) -> number[0,1]
// deps:        tags/schema (registry shape), score/squelch-derive (ctx.valueFor/reliabilityFor producers)
// realtime:    batch-only
// tested-by:   tests/tags-extract.test.js
// @unit-end
"use strict";
const ACCEL_CAP = { none: 1.0, disambiguates: 0.6, required: 0.4 };
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function confidence(value, reliabilityFactor, accelDep) {
  const sharp = clamp01(2 * Math.abs(value - 0.5));
  return clamp01(reliabilityFactor) * sharp * (ACCEL_CAP[accelDep] != null ? ACCEL_CAP[accelDep] : 1.0);
}
// extractTags: for each registry tag, read its detection band/measure from ctx and emit {value,confidence}.
// value sources per starter tag: tonality -> ctx.subbass median tonality over the event; chaos not a tag;
// sub-bass-ratio -> subbass energy / (subbass+low+mid+high energy); level -> delta-dB (event median
// level_db - floorAt(subbass,speed)) normalised by a LEVEL_NORM_DB (e.g. 20) into [0,1]; onset-sharpness
// -> normalised attack slope of the event's chaos rise; speech-contaminated -> 1 if speech flag set.
function extractTags(event, ctx) {
  const tags = {}, accel_gaps = [];
  for (const name in ctx.registry) {
    const rec = ctx.registry[name];
    const v = ctx.valueFor(name, event); // ctx supplies the per-tag value calc (keeps this fn small)
    if (v == null) continue;
    const relTag = ctx.reliabilityFor(name, event);
    tags[name] = { value: +v.toFixed(3), confidence: +confidence(v, relTag, rec.accel_dependency).toFixed(3) };
    if (rec.accel_dependency !== "none") accel_gaps.push(name);
  }
  return { tags, accel_gaps };
}
// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { confidence, extractTags, ACCEL_CAP };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
