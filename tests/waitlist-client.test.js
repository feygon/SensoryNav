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
  window: {
    addEventListener() {},
    location: {
      hostname: "localhost"
    },
    SensoryNavTheme: {
      applyTheme() {},
      getTheme() {
        return "light";
      },
      toggleTheme() {}
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
        json: () => Promise.resolve({ version: "0.2.5" })
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
  assert.strictEqual(fetchPayload.options.headers.Accept, "application/json");
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

const githubContext = makeGithubPagesContext();
vm.createContext(githubContext);
vm.runInContext(script, githubContext);
githubContext.submitHandler({ preventDefault() {} });

setImmediate(() => {
  assert.strictEqual(githubContext.fetchPayload.url, "https://formsubmit.co/ajax/rnickerson@realfeygon.com");
  assert.deepStrictEqual(JSON.parse(githubContext.fetchPayload.options.body), {
    email: "test@sample.com",
    tag: "waitlist",
    source: "SensoryNav",
    signup_count: 1,
    submitted_at: githubContext.now,
    _subject: "SensoryNav waitlist signup",
    _template: "table",
    _captcha: "false"
  });
});

function makeGithubPagesContext() {
  const githubStore = { "sensorynav-waitlist": "[]" };
  let handler;
  const githubForm = {
    addEventListener(type, nextHandler) {
      if (type === "submit") {
        handler = nextHandler;
      }
    },
    reset() {
      this.resetCalled = true;
    }
  };
  const githubStatus = { textContent: "" };
  const now = "2026-05-22T12:00:00.000Z";
  let fetchPayload;

  return {
    console,
    JSON,
    Map,
    Array,
    String,
    Date: class Date {
      constructor() {}
      toISOString() {
        return now;
      }
    },
    now,
    get submitHandler() {
      return handler;
    },
    get fetchPayload() {
      return fetchPayload;
    },
    window: {
      addEventListener() {},
      location: {
        hostname: "feygon.github.io"
      },
      SensoryNavTheme: {
        applyTheme() {},
        getTheme() {
          return "light";
        },
        toggleTheme() {}
      }
    },
    localStorage: {
      getItem(key) {
        return githubStore[key] || null;
      },
      setItem(key, value) {
        githubStore[key] = value;
      }
    },
    document: {
      getElementById(id) {
        return {
          "waitlist-form": githubForm,
          "form-status": githubStatus,
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
          json: () => Promise.resolve({ version: "0.2.5" })
        });
      }

      fetchPayload = { url, options };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: "true",
          message: "The form was submitted successfully."
        })
      });
    }
  };
}
