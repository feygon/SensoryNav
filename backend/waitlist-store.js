const fs = require("fs");
const path = require("path");

function createWaitlistStore(filePath) {
  const resolvedPath = path.resolve(filePath);

  function readAll() {
    ensureFile();
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    return normalizeEntries(Array.isArray(parsed) ? parsed : []);
  }

  function upsert(signup) {
    const email = normalizeEmail(signup.email);

    if (!email) {
      const error = new Error("Email is required.");
      error.code = "EMAIL_REQUIRED";
      throw error;
    }

    const now = signup.now || new Date().toISOString();
    const entries = readAll();
    const existing = entries.find((entry) => entry.email === email);

    if (existing) {
      existing.signup_count = (existing.signup_count || 1) + 1;
      existing.updated_at = now;
      existing.last_source = signup.source || existing.last_source || "SensoryNav";
      existing.tags = mergeTags(existing.tags, signup.tag || "waitlist");
      writeAll(entries);
      return { signup: existing, created: false };
    }

    const createdSignup = {
      email,
      tags: mergeTags([], signup.tag || "waitlist"),
      source: signup.source || "SensoryNav",
      last_source: signup.source || "SensoryNav",
      created_at: now,
      updated_at: now,
      signup_count: 1
    };

    entries.push(createdSignup);
    writeAll(entries);
    return { signup: createdSignup, created: true };
  }

  function ensureFile() {
    const directory = path.dirname(resolvedPath);

    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(resolvedPath)) {
      fs.writeFileSync(resolvedPath, "[]\n", "utf8");
    }
  }

  function writeAll(entries) {
    ensureFile();
    fs.writeFileSync(resolvedPath, `${JSON.stringify(normalizeEntries(entries), null, 2)}\n`, "utf8");
  }

  return {
    readAll,
    upsert
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeEntries(entries) {
  const merged = new Map();

  for (const entry of entries) {
    const email = normalizeEmail(entry.email);

    if (!email) {
      continue;
    }

    const signupCount = Number.isFinite(entry.signup_count) ? entry.signup_count : 1;
    const current = merged.get(email);

    if (current) {
      current.signup_count += signupCount;
      current.updated_at = latestDate(current.updated_at, entry.updated_at || entry.created_at);
      current.tags = mergeTags(current.tags, entry.tags || entry.tag || "waitlist");
      continue;
    }

    merged.set(email, {
      email,
      tags: mergeTags([], entry.tags || entry.tag || "waitlist"),
      source: entry.source || "SensoryNav",
      last_source: entry.last_source || entry.source || "SensoryNav",
      created_at: entry.created_at || new Date().toISOString(),
      updated_at: entry.updated_at || entry.created_at || new Date().toISOString(),
      signup_count: signupCount
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.email.localeCompare(right.email));
}

function mergeTags(existingTags, incomingTags) {
  const tags = new Set();
  const allTags = []
    .concat(existingTags || [])
    .concat(incomingTags || []);

  for (const tag of allTags) {
    const normalizedTag = String(tag || "").trim();

    if (normalizedTag) {
      tags.add(normalizedTag);
    }
  }

  return Array.from(tags).sort();
}

function latestDate(firstDate, secondDate) {
  if (!firstDate) {
    return secondDate;
  }

  if (!secondDate) {
    return firstDate;
  }

  return new Date(firstDate) > new Date(secondDate) ? firstDate : secondDate;
}

module.exports = {
  createWaitlistStore,
  normalizeEmail,
  normalizeEntries
};
