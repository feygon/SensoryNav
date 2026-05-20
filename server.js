const http = require("http");
const fs = require("fs");
const path = require("path");
const { createWaitlistStore } = require("./backend/waitlist-store");

const rootDirectory = __dirname;
const dataPath = process.env.WAITLIST_DATA_PATH || path.join(rootDirectory, "data", "waitlist.json");
const port = Number(process.env.PORT || 8787);
const store = createWaitlistStore(dataPath);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/waitlist") {
      await handleWaitlistPost(request, response);
      return;
    }

    if (request.method === "GET" && request.url === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, { error: "Internal server error." });
  }
});

async function handleWaitlistPost(request, response) {
  const body = await readJsonBody(request);
  const result = store.upsert({
    email: body.email,
    tag: body.tag || "waitlist",
    source: body.source || "SensoryNav"
  });

  sendJson(response, result.created ? 201 : 200, {
    ok: true,
    created: result.created,
    signup: result.signup
  });
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(rootDirectory, requestedPath));

  if (!filePath.startsWith(rootDirectory)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 10000) {
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

if (require.main === module) {
  server.listen(port, () => {
    console.log(`SensoryNav backend running at http://localhost:${port}`);
    console.log(`Waitlist data file: ${dataPath}`);
  });
}

module.exports = {
  server
};
