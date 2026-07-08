// ribbon-render.js — the ONE spectral-chaos ribbon renderer. Used by BOTH scripts/squelch-ribbon.js
// (which produces out/score/ribbon-*.html) and analyze.html, so the two are byte-identical. Renders
// subbass/low/mid/high from a squelch-clean.json shape: centre line = band level (dB), ribbon
// half-width = chaos, hue blue=tonal -> yellow=chaotic (thickness carries chaos too, CVD-safe).
//
// drawRibbon(sources, cfg, mount): sources = { squelch: <squelch-clean.json>, tags?: <tags-clean.json> },
// cfg = { label }, mount = the element to render the SVG into. When sources.tags is given, its events
// are marked as dots along the bottom edge of each band row (same events the timeline marks); absent
// tags => no dots (so the standalone ribbon pages stay byte-identical).
(function () {
  "use strict";
  function drawRibbon(sources, cfg, mount) {
    const sq = sources.squelch;
    if (!sq) { mount.textContent = "no squelch data"; return; }
    const events = (sources.tags && sources.tags.events) || [];
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const BANDS = [
      { key: "subbass", label: "sub-bass 20–80 Hz", line: "#ebd73c" },
      { key: "low", label: "low 80–250 Hz", line: "#5fd35f" },
      { key: "mid", label: "mid 250–1000 Hz", line: "#b98cff" },
      { key: "high", label: "high 1000–4000 Hz", line: "#ff7bac" }
    ].filter((b) => sq[b.key] && sq[b.key].length);
    const CHAOS_DB = 8; // chaos in [0,1] -> ribbon half-width in dB (matches the timeline's CHAOS_DISPLAY_DB)
    const W = 1240, mL = 58, mR = 20, plotW = W - mL - mR, top0 = 40, hP = 176, gap = 46;
    const H = top0 + BANDS.length * (hP + gap);
    // blue (tonal) -> yellow (chaotic); t = chaos = 1 - tonality
    function hue(tonality) {
      const t = Math.max(0, Math.min(1, 1 - (tonality == null ? 0.5 : tonality)));
      const a = [58, 111, 216], b = [235, 215, 60];
      return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
    }
    const parts = [
      '<rect width="' + W + '" height="' + H + '" fill="#1a1a1a"/>',
      '<text x="' + mL + '" y="24" fill="#f5f5f5" font-size="16" font-weight="600">' +
        esc(cfg.label) + " — spectral-chaos ribbon</text>"
    ];
    BANDS.forEach((band, bi) => {
      const pts = sq[band.key];
      const top = top0 + bi * (hP + gap);
      let dmin = Infinity, dmax = -Infinity;
      pts.forEach((p) => { const hw = (p.chaos || 0) * CHAOS_DB; dmin = Math.min(dmin, p.level_db - hw); dmax = Math.max(dmax, p.level_db + hw); });
      dmin -= 2; dmax += 2;
      const maxT = pts[pts.length - 1].t || 1;
      const x = (t) => mL + (t / maxT) * plotW;
      const y = (db) => top + hP * (1 - (db - dmin) / (dmax - dmin));
      const bw = Math.max(1, plotW / pts.length);
      for (let db = Math.ceil(dmin / 5) * 5; db <= dmax; db += 5) {
        parts.push('<line x1="' + mL + '" y1="' + y(db).toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + y(db).toFixed(1) + '" stroke="#333" stroke-width="0.6"/>');
        parts.push('<text x="' + (mL - 8) + '" y="' + (y(db) + 4).toFixed(1) + '" fill="#888" font-size="11" text-anchor="end">' + db + "</text>");
      }
      let line = "";
      pts.forEach((p) => {
        const hw = (p.chaos || 0) * CHAOS_DB, yTop = y(p.level_db + hw), yBot = y(p.level_db - hw);
        parts.push('<rect x="' + (x(p.t) - bw / 2).toFixed(2) + '" y="' + yTop.toFixed(1) +
          '" width="' + bw.toFixed(2) + '" height="' + Math.max(0.4, yBot - yTop).toFixed(1) +
          '" fill="' + hue(p.tonality) + '" opacity="0.5"/>');
        line += x(p.t).toFixed(1) + "," + y(p.level_db).toFixed(1) + " ";
      });
      parts.push('<polyline fill="none" stroke="' + band.line + '" stroke-width="1.3" points="' + line.trim() + '"/>');
      // tag-event dots along the bottom edge (same events the timeline marks), when tags are given
      events.forEach((ev) => {
        const tm = (ev.t_start + ev.t_end) / 2;
        if (tm < 0 || tm > maxT) return;
        parts.push('<circle cx="' + x(tm).toFixed(1) + '" cy="' + (top + hP - 5).toFixed(1) + '" r="2.6" fill="#dcdcdc" opacity="0.55"/>');
      });
      parts.push('<rect x="' + mL + '" y="' + top + '" width="' + plotW + '" height="' + hP + '" fill="none" stroke="#888" stroke-width="1"/>');
      parts.push('<text x="' + mL + '" y="' + (top - 8) + '" fill="#dcdcdc" font-size="12">' +
        esc(band.label) + " · level (dB), ribbon width = chaos, hue tonal→chaos</text>");
    });
    mount.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto">' +
      parts.join("") + "</svg>";
  }

  const api = { drawRibbon: drawRibbon };
  if (typeof window !== "undefined") { window.SensoryNavRibbon = api; }
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}());
