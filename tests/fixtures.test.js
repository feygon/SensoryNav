// tests/fixtures.test.js
const assert = require("assert");
const { buildFixtureSession } = require("../recorder/fixtures");
const { validateSession } = require("../recorder/session-export");

const session = buildFixtureSession();

assert.ok(session.located_samples.length >= 30, "at least 30 located windows");

const scores = session.located_samples.map((s) => s.auditory_roughness_score);
assert.ok(scores.some((s) => s <= 33), "has a smooth-tier score");
assert.ok(scores.some((s) => s > 33 && s <= 66), "has a moderate-tier score");
assert.ok(scores.some((s) => s > 66), "has a rough-tier score");

assert.ok(session.located_samples.every((s) => /^#[0-9a-f]{6}$/.test(s.color)));

const result = validateSession(session);
assert.strictEqual(result.valid, true, JSON.stringify(result.errors));

console.log("fixtures tests passed");
