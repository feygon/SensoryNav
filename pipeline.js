// pipeline.js — the shared pipeline/tier strip shown across the whole app:
// Capture -> Local analysis -> Deidentified upload -> Aggregator -> Route map, with live/planned
// badges. ONE source so the visual stays identical on every page. Auto-mounts into
// <div id="pipeline-strip" data-active="<key>"></div>: the active tier is highlighted, and every
// other tier that has a destination becomes a link (cross-navigation). Exposes window.SensoryNavPipeline.
(function () {
  "use strict";
  var TIERS = [
    { key: "capture", ico: "🎙️", t: "Capture", live: true, href: "capture.html", cta: "Record a drive →", d: "Audio + GPS recorded in the browser, on your device." },
    { key: "analysis", ico: "🧠", t: "Local analysis", live: true, href: "analyze.html", cta: "Upload a capture →", d: "Spectral-chaos + roughness + tags computed locally. Audio never leaves the device." },
    { key: "upload", ico: "🔒", t: "Deidentified upload", live: false, d: "Only derived features leave — no audio, identifiers stripped." },
    { key: "aggregator", ico: "🗺️", t: "Aggregator", live: false, d: "Weights many trips into one confident, per-location road-feel signal." },
    { key: "map", ico: "📊", t: "Route map", live: false, d: "A calmer-route chooser and real-time rough-stretch warnings." }
  ];

  function tierHtml(x, active, isLast) {
    var isActive = x.key === active, asLink = !!x.href && !isActive, badge = x.live ? "live" : "planned";
    var cls = "tier " + badge + (isActive ? " active" : "") + (asLink ? " tier-link" : "");
    var inner =
      '<div class="ico">' + x.ico + "</div>" +
      '<div class="t">' + x.t + ' <span class="badge ' + badge + '">' + badge + "</span></div>" +
      '<div class="d">' + x.d + "</div>" +
      (asLink && x.cta ? '<div class="cta">' + x.cta + "</div>" : "") +
      (isLast ? "" : '<span class="arrow" aria-hidden="true">→</span>');
    if (asLink) return '<a class="' + cls + '" href="' + x.href + '">' + inner + "</a>";
    return '<div class="' + cls + '"' + (isActive ? ' aria-current="page"' : "") + ">" + inner + "</div>";
  }

  function render(mount, active) {
    mount.className = "arch";
    mount.setAttribute("aria-label", "Pipeline");
    mount.innerHTML = TIERS.map(function (x, i) { return tierHtml(x, active, i === TIERS.length - 1); }).join("");
  }

  function mountDefault() {
    var el = document.getElementById("pipeline-strip");
    if (el) render(el, el.getAttribute("data-active") || "");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountDefault);
  else mountDefault();

  window.SensoryNavPipeline = { render: render, TIERS: TIERS };
}());
