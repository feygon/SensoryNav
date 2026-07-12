const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");
const buildVersion = document.getElementById("build-version");
const modeCopy = document.getElementById("mode-copy");
const productionWaitlistEndpoint = "https://formsubmit.co/ajax/rnickerson@realfeygon.com";
let waitlist = normalizeWaitlist(JSON.parse(localStorage.getItem("sensorynav-waitlist") || "[]"));

localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));

fetch("build.json?v=0.2.5")
  .then((response) => response.json())
  .then((build) => {
    buildVersion.textContent = `v${build.version}`;
  })
  .catch(() => {
    buildVersion.textContent = "";
  });

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = normalizeEmail(new FormData(form).get("email"));
  const now = new Date().toISOString();

  if (!email) {
    status.textContent = "Enter an email address.";
    return;
  }

  status.textContent = "Joining...";

  try {
    const signup = await submitWaitlistSignup(email, now);
    mirrorSignupLocally(signup);
    form.reset();
    status.textContent = "You're on the waitlist.";
  } catch (error) {
    saveLocalSignup(email, now);
    status.textContent = "Saved on this device. Waitlist sync is unavailable; please try again later.";
  }
});

renderModeCopy();
window.addEventListener("sensorynav-theme-change", renderModeCopy);

async function submitWaitlistSignup(email, now) {
  const signupPayload = {
    email,
    tag: "waitlist",
    source: "SensoryNav"
  };
  const endpoint = getWaitlistEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(endpoint === productionWaitlistEndpoint
      ? formSubmitPayload(signupPayload, now)
      : signupPayload)
  });

  if (!response.ok) {
    throw new Error("Waitlist API request failed.");
  }

  const responsePayload = await response.json();

  if (endpoint === productionWaitlistEndpoint) {
    return {
      email,
      tag: "waitlist",
      source: "SensoryNav",
      created_at: now,
      updated_at: now,
      signup_count: nextLocalSignupCount(email)
    };
  }

  if (!responsePayload.ok || !responsePayload.signup) {
    throw new Error("Waitlist API returned an invalid response.");
  }

  return responsePayload.signup;
}

function getWaitlistEndpoint() {
  if (window.SENSORYNAV_WAITLIST_API_URL) {
    return window.SENSORYNAV_WAITLIST_API_URL;
  }

  return isGitHubPages() ? productionWaitlistEndpoint : "/api/waitlist";
}

function isGitHubPages() {
  return window.location && window.location.hostname.endsWith("github.io");
}

function formSubmitPayload(payload, now) {
  return {
    email: payload.email,
    tag: payload.tag,
    source: payload.source,
    signup_count: nextLocalSignupCount(payload.email),
    submitted_at: now,
    _subject: "SensoryNav waitlist signup",
    _template: "table",
    _captcha: "false"
  };
}

function nextLocalSignupCount(email) {
  const existingSignup = waitlist.find((signup) => signup.email === email);
  return existingSignup ? (existingSignup.signup_count || 1) + 1 : 1;
}

function mirrorSignupLocally(signup) {
  const email = normalizeEmail(signup.email);

  if (!email) {
    return;
  }

  const existingSignup = waitlist.find((entry) => entry.email === email);
  const mirroredSignup = {
    email,
    tag: "waitlist",
    source: signup.source || "SensoryNav",
    created_at: signup.created_at,
    updated_at: signup.updated_at,
    signup_count: signup.signup_count || 1
  };

  if (existingSignup) {
    Object.assign(existingSignup, mirroredSignup);
  } else {
    waitlist.push(mirroredSignup);
  }

  localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));
}

function saveLocalSignup(email, now) {
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
}

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
  const isDarkMode = window.SensoryNavTheme
    ? window.SensoryNavTheme.getTheme() === "dark"
    : document.body.classList.contains("dark-mode");

  modeCopy.innerHTML = isDarkMode
    ? `A map with a calmer route for people who want smoother, quieter roads, and fewer sensory ambushes, like that nasty white webpage. Click <button type="button" class="theme-button inline-theme-button" id="dark-mode-link" data-theme-toggle></button> to go back to light mode... <em>*shudder*</em>`
    : `A map with a calmer route for people who want smoother, quieter roads, and fewer sensory ambushes, <strong>like this nasty white webpage</strong>. Click <button type="button" class="theme-button inline-theme-button" id="dark-mode-link" data-theme-toggle></button> for dark mode.`;

  if (window.SensoryNavTheme) {
    window.SensoryNavTheme.applyTheme(window.SensoryNavTheme.getTheme());
  }

  if (!window.SensoryNavTheme) {
    document.getElementById("dark-mode-link").addEventListener("click", (event) => {
      event.preventDefault();
      document.body.classList.toggle("dark-mode");
      renderModeCopy();
    });
  }
}
