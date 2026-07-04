const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync("theme.js", "utf8");

function classListFor(classes) {
  return {
    toggle(name, force) {
      if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    }
  };
}

// Build a fresh DOM/window sandbox, run theme.js in it, and hand back the
// observable bits. `matchMedia` is omitted entirely when `system` is null so we
// can exercise the "browser has no preference API" path too.
function run({ storedTheme, system }) {
  const store = {};
  if (storedTheme) {
    store["sensorynav-theme"] = storedTheme;
  }
  const htmlClasses = new Set();
  const bodyClasses = new Set();
  const rootStyle = {};
  const toggleEl = { innerHTML: "" , setAttribute(name, value) { this[name] = value; } };
  let dispatched = null;
  let clickHandler = null;

  const window = {
    dispatchEvent(event) { dispatched = event; }
  };
  if (system !== null) {
    window.matchMedia = function (query) {
      return {
        matches: system === "dark" && query === "(prefers-color-scheme: dark)",
        addEventListener() {},
        addListener() {}
      };
    };
  }

  const context = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail; }
    },
    localStorage: {
      getItem(key) { return store[key] || null; },
      setItem(key, value) { store[key] = value; }
    },
    window,
    document: {
      readyState: "complete",
      documentElement: { classList: classListFor(htmlClasses), style: rootStyle },
      body: { classList: classListFor(bodyClasses) },
      querySelectorAll(selector) {
        return selector === "[data-theme-toggle]" ? [toggleEl] : [];
      },
      addEventListener(type, handler) {
        if (type === "click") { clickHandler = handler; }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(script, context);
  return { store, htmlClasses, bodyClasses, rootStyle, toggleEl, getDispatched: () => dispatched, click: () => clickHandler({
    preventDefault() {},
    target: { closest(selector) { return selector === "[data-theme-toggle]" ? toggleEl : null; } }
  }) };
}

// Scenario A: an explicit stored "dark" choice applies dark, sets color-scheme,
// labels the toggle, and a click flips it to light (and persists that choice).
const a = run({ storedTheme: "dark", system: null });
assert.strictEqual(a.htmlClasses.has("dark-mode"), true);
assert.strictEqual(a.bodyClasses.has("dark-mode"), true);
assert.strictEqual(a.rootStyle.colorScheme, "dark");
assert.strictEqual(a.toggleEl.innerHTML.includes("bulb-icon-on"), true);
assert.strictEqual(a.toggleEl.innerHTML.includes("Light mode"), true);
assert.strictEqual(a.toggleEl["aria-label"], "Switch to light mode");

a.click();
assert.strictEqual(a.store["sensorynav-theme"], "light");
assert.strictEqual(a.htmlClasses.has("dark-mode"), false);
assert.strictEqual(a.bodyClasses.has("dark-mode"), false);
assert.strictEqual(a.rootStyle.colorScheme, "light");
assert.strictEqual(a.getDispatched().detail.theme, "light");
assert.strictEqual(a.toggleEl.innerHTML.includes("bulb-icon-off"), true);
assert.strictEqual(a.toggleEl.innerHTML.includes('fill="#000"'), true);
assert.strictEqual(a.toggleEl.innerHTML.includes('fill="#fff"'), true);
assert.strictEqual(a.toggleEl.innerHTML.includes("Dark mode"), true);
assert.strictEqual(a.toggleEl["aria-label"], "Switch to dark mode");

// Scenario B: NO stored choice + the browser reports dark => we defer to the
// browser and render dark. This is the "subservient to Chrome" behavior.
const b = run({ storedTheme: null, system: "dark" });
assert.strictEqual(b.htmlClasses.has("dark-mode"), true, "system-dark should apply dark without a stored choice");
assert.strictEqual(b.rootStyle.colorScheme, "dark");

// Scenario C: NO stored choice + the browser reports light => light.
const c = run({ storedTheme: null, system: "light" });
assert.strictEqual(c.htmlClasses.has("dark-mode"), false);
assert.strictEqual(c.rootStyle.colorScheme, "light");

// Scenario D: an explicit "light" choice OVERRIDES a system that reports dark.
const d = run({ storedTheme: "light", system: "dark" });
assert.strictEqual(d.htmlClasses.has("dark-mode"), false, "explicit light must beat system dark");
assert.strictEqual(d.rootStyle.colorScheme, "light");

console.log("theme tests passed");
