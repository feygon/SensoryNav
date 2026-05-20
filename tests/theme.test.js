const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync("theme.js", "utf8");
const store = { "sensorynav-theme": "dark" };
const htmlClasses = new Set();
const bodyClasses = new Set();
let themeHandler;
const toggleLabels = [];
const themeToggle = {
  textContent: "",
  innerHTML: "",
  setAttribute(name, value) {
    this[name] = value;
  },
  addEventListener(type, handler) {
    toggleLabels.push({ type, handler, element: this });
  }
};

const context = {
  console,
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  localStorage: {
    getItem(key) {
      return store[key] || null;
    },
    setItem(key, value) {
      store[key] = value;
    }
  },
  window: {
    dispatchEvent(event) {
      themeHandler = event;
    }
  },
  document: {
    readyState: "complete",
    documentElement: {
      classList: classListFor(htmlClasses)
    },
    body: {
      classList: classListFor(bodyClasses)
    },
    querySelectorAll(selector) {
      if (selector !== "[data-theme-toggle]") {
        return [];
      }

      return [themeToggle];
    }
  }
};

vm.createContext(context);
vm.runInContext(script, context);

assert.strictEqual(htmlClasses.has("dark-mode"), true);
assert.strictEqual(bodyClasses.has("dark-mode"), true);
assert.strictEqual(toggleLabels[0].element.innerHTML.includes("bulb-icon-on"), true);
assert.strictEqual(toggleLabels[0].element.innerHTML.includes("Light mode"), true);
assert.strictEqual(toggleLabels[0].element["aria-label"], "Switch to light mode");

toggleLabels[0].handler({ preventDefault() {} });

assert.strictEqual(store["sensorynav-theme"], "light");
assert.strictEqual(htmlClasses.has("dark-mode"), false);
assert.strictEqual(bodyClasses.has("dark-mode"), false);
assert.strictEqual(themeHandler.detail.theme, "light");
assert.strictEqual(toggleLabels[0].element.innerHTML.includes("bulb-icon-off"), true);
assert.strictEqual(toggleLabels[0].element.innerHTML.includes("Dark mode"), true);
assert.strictEqual(toggleLabels[0].element["aria-label"], "Switch to dark mode");

console.log("theme tests passed");

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
