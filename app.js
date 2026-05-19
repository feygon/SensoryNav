const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");
const buildVersion = document.getElementById("build-version");
const modeCopy = document.getElementById("mode-copy");
let waitlist = normalizeWaitlist(JSON.parse(localStorage.getItem("sensorynav-waitlist") || "[]"));

localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));

fetch("build.json?v=0.0.9")
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

renderModeCopy();

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

function renderModeCopy() {
  const isDarkMode = document.body.classList.contains("dark-mode");

  modeCopy.innerHTML = isDarkMode
    ? `A map with a calmer route for people who want smoother, quieter roads, and fewer sensory ambushes, like that nasty white webpage. Click <a href="#" id="dark-mode-link">here</a> to go back to light mode... <em>*shudder*</em>`
    : `A map with a calmer route for people who want smoother, quieter roads, and fewer sensory ambushes, <strong>like this nasty white webpage</strong>. Click <a href="#" id="dark-mode-link">here</a> for dark mode.`;

  document.getElementById("dark-mode-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.body.classList.toggle("dark-mode");
    renderModeCopy();
  });
}
