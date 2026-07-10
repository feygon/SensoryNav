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
