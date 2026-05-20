const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWaitlistStore, normalizeEntries } = require("../backend/waitlist-store");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sensorynav-waitlist-"));
const dataPath = path.join(tempDirectory, "waitlist.json");
const store = createWaitlistStore(dataPath);

let result = store.upsert({
  email: " New@Sample.com ",
  tag: "waitlist",
  source: "test",
  now: "2026-05-20T10:00:00.000Z"
});

assert.strictEqual(result.created, true);
assert.strictEqual(result.signup.email, "new@sample.com");
assert.strictEqual(result.signup.signup_count, 1);
assert.deepStrictEqual(result.signup.tags, ["waitlist"]);

result = store.upsert({
  email: "new@sample.com",
  tag: "waitlist",
  source: "test",
  now: "2026-05-20T10:05:00.000Z"
});

assert.strictEqual(result.created, false);
assert.strictEqual(result.signup.signup_count, 2);
assert.strictEqual(result.signup.updated_at, "2026-05-20T10:05:00.000Z");

const stored = JSON.parse(fs.readFileSync(dataPath, "utf8"));
assert.strictEqual(stored.length, 1);
assert.strictEqual(stored[0].email, "new@sample.com");
assert.strictEqual(stored[0].signup_count, 2);

const normalized = normalizeEntries([
  { email: "A@Example.com", tag: "waitlist", signup_count: 1 },
  { email: "a@example.com", tags: ["extra"], signup_count: 2 }
]);

assert.strictEqual(normalized.length, 1);
assert.strictEqual(normalized[0].signup_count, 3);
assert.deepStrictEqual(normalized[0].tags, ["extra", "waitlist"]);

console.log("waitlist store tests passed");
