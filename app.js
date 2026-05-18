const form = document.getElementById("waitlist-form");
const status = document.getElementById("form-status");
const downloadLink = document.getElementById("download-json");
const buildVersion = document.getElementById("build-version");
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

  const blob = new Blob([JSON.stringify(waitlist, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  downloadLink.href = url;
  downloadLink.download = "sensorynav-waitlist.json";
  downloadLink.textContent = "Download waitlist JSON";

  form.reset();
  status.textContent = "You're on the waitlist. Saved locally as JSON.";
});
