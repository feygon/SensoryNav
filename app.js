const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");
const buildVersion = document.getElementById("build-version");
const darkModeLink = document.getElementById("dark-mode-link");
const waitlist = JSON.parse(localStorage.getItem("sensorynav-waitlist") || "[]");

fetch("build.json")
  .then((response) => response.json())
  .then((build) => {
    buildVersion.textContent = `v${build.version}`;
  })
  .catch(() => {
    buildVersion.textContent = "";
  });

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const email = new FormData(form).get("email");
  const signup = {
    email,
    tag: "waitlist",
    source: "SensoryNav",
    created_at: new Date().toISOString()
  };

  waitlist.push(signup);
  localStorage.setItem("sensorynav-waitlist", JSON.stringify(waitlist, null, 2));

  form.reset();
  status.textContent = "You're on the waitlist.";
});

darkModeLink.addEventListener("click", (event) => {
  event.preventDefault();
  document.body.classList.add("dark-mode");
});
