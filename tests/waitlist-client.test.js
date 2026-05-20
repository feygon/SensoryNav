const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const script = fs.readFileSync("app.js", "utf8");
const store = { "sensorynav-waitlist": "[]" };
let submitHandler;
let fetchPayload;

const form = {
  addEventListener(type, handler) {
    if (type === "submit") {
      submitHandler = handler;
    }
  },
  reset() {
    this.resetCalled = true;
  }
};

const context = {
  console,
  Date,
  JSON,
  Map,
  Array,
  String,
  localStorage: {
    getItem(key) {
      return store[key] || null;
    },
    setItem(key, value) {
      store[key] = value;
    }
  },
  document: {
    getElementById(id) {
      return {
        "waitlist-form": form,
        "form-status": { textContent: "" },
        "build-version": { textContent: "" },
        "mode-copy": { innerHTML: "" },
        "dark-mode-link": { addEventListener() {} }
      }[id];
    },
    body: {
      classList: {
        contains() {
          return false;
        },
        toggle() {}
      }
    }
  },
  FormData: class FormData {
    get(name) {
      return name === "email" ? " Test@Sample.com " : null;
    }
  },
  fetch(url, options) {
    if (url.startsWith("build.json")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: "0.2.0" })
      });
    }

    fetchPayload = { url, options };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        signup: {
          email: "test@sample.com",
          signup_count: 1
        }
      })
    });
  }
};

vm.createContext(context);
vm.runInContext(script, context);

submitHandler({ preventDefault() {} });

setImmediate(() => {
  assert.strictEqual(fetchPayload.url, "/api/waitlist");
  assert.deepStrictEqual(JSON.parse(fetchPayload.options.body), {
    email: "test@sample.com",
    tag: "waitlist",
    source: "SensoryNav"
  });
  assert.deepStrictEqual(JSON.parse(store["sensorynav-waitlist"]), [{
    email: "test@sample.com",
    tag: "waitlist",
    source: "SensoryNav",
    signup_count: 1
  }]);
  console.log("waitlist client tests passed");
});
