const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");
const buildVersion = document.getElementById("build-version");
const darkModeLink = document.getElementById("dark-mode-link");
let waitlist = normalizeWaitlist(JSON.parse(localStorage.getItem("sensorynav-waitlist") || "[]"));

localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));

fetch("build.json?v=0.0.6")
  .then((response) => response.json())
  .then((build) => {
    buildVersion.textContent = `v${build.version}`;
  })
  .catch(() => {
    buildVersion.textContent = "";
  });

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = normalizeEmail(new FormData(form).get("email"));
  const now = new Date().toISOString();

  if (!email) {
    status.textContent = "Enter an email address.";
    return;
  }

  const existingSignup = waitlist.find((signup) => signup.email === email);

  if (existingSignup) {
    existingSignup.signup_count = (existingSignup.signup_count || 1) + 1;
    existingSignup.updated_at = now;
  } else {
    waitlist.push({
      email,
      tag: "waitlist",
      source: "SensoryNav",
      created_at: now,
      updated_at: now,
      signup_count: 1
    });
  }

  localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));

  form.reset();
  status.textContent = "You're on the waitlist.";
});

darkModeLink.addEventListener("click", (event) => {
  event.preventDefault();
  document.body.classList.add("dark-mode");
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeWaitlist(entries) {
  const merged = new Map();

  for (const entry of entries) {
    const email = normalizeEmail(entry.email);

    if (!email) {
      continue;
    }

    const current = merged.get(email);
    const signupCount = entry.signup_count || 1;

    if (current) {
      current.signup_count += signupCount;
      current.updated_at = latestDate(current.updated_at, entry.updated_at || entry.created_at);
      continue;
    }

    merged.set(email, {
      ...entry,
      email,
      tag: entry.tag || "waitlist",
      source: entry.source || "SensoryNav",
      created_at: entry.created_at || new Date().toISOString(),
      updated_at: entry.updated_at || entry.created_at || new Date().toISOString(),
      signup_count: signupCount
    });
  }

  return Array.from(merged.values());
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
