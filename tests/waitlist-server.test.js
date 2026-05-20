const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sensorynav-server-"));
const dataPath = path.join(tempDirectory, "waitlist.json");

process.env.WAITLIST_DATA_PATH = dataPath;

const { server } = require("../server");

server.listen(0, async () => {
  const { port } = server.address();

  try {
    let response = await postJson(port, "/api/waitlist", {
      email: " New@Sample.com ",
      tag: "waitlist",
      source: "server-test"
    });

    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(response.body.created, true);
    assert.strictEqual(response.body.signup.email, "new@sample.com");
    assert.strictEqual(response.body.signup.signup_count, 1);

    response = await postJson(port, "/api/waitlist", {
      email: "new@sample.com",
      tag: "waitlist",
      source: "server-test"
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.created, false);
    assert.strictEqual(response.body.signup.signup_count, 2);

    const stored = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].email, "new@sample.com");
    assert.strictEqual(stored[0].signup_count, 2);

    console.log("waitlist server tests passed");
  } finally {
    server.close();
  }
});

function postJson(port, requestPath, payload) {
  return new Promise((resolve, reject) => {
    const rawPayload = JSON.stringify(payload);
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(rawPayload)
      }
    }, (response) => {
      let rawResponse = "";

      response.on("data", (chunk) => {
        rawResponse += chunk;
      });

      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(rawResponse)
        });
      });
    });

    request.on("error", reject);
    request.write(rawPayload);
    request.end();
  });
}
