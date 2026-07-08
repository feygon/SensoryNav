// ribbon-render.js — the ONE spectral-chaos ribbon renderer. Used by BOTH scripts/squelch-ribbon.js
// (which produces out/score/ribbon-*.html) and analyze.html. Renders subbass/low/mid/high from a
// squelch-clean.json shape: centre line = band level (dB), ribbon half-width = chaos, hue blue=tonal
// -> yellow=chaotic (thickness carries chaos too, CVD-safe).
//
// drawRibbon(sources, cfg, mount): sources = { squelch: <squelch-clean.json>, tags?: <tags-clean.json> },
// cfg = { label }, mount = the element to render into. When sources.tags is given, its events are
// marked as TICKS along the bottom edge of each band row (same events the timeline marks). Hovering
// any panel shows a guide line with dots at the top/bottom of the chaos band + a value tooltip; near
// an event tick the tooltip also lists that event's tags. Absent tags => no ticks (standalone pages
// stay visually identical).
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
    const W = 1240, mL = 58, mR = 20, plotW = W - mL - mR, top0 = 58, hP = 176, gap = 46;
    const H = top0 + BANDS.length * (hP + gap);
    // blue (tonal) -> yellow (chaotic); t = chaos = 1 - tonality
    function hue(tonality) {
      const t = Math.max(0, Math.min(1, 1 - (tonality == null ? 0.5 : tonality)));
      const a = [58, 111, 216], b = [235, 215, 60];
      return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
    }

    // Per-band geometry. ALL bands share ONE dB axis (same dmin/dmax, same height) so their spectral
    // lines are directly comparable — identical data reads as identical, and real differences between
    // bands stay visible instead of being hidden by per-band auto-scaling.
    const meta = BANDS.map((band, bi) => {
      const pts = sq[band.key];
      const top = top0 + bi * (hP + gap);
      let dmin = Infinity, dmax = -Infinity;
      pts.forEach((p) => { const hw = (p.chaos || 0) * CHAOS_DB; dmin = Math.min(dmin, p.level_db - hw); dmax = Math.max(dmax, p.level_db + hw); });
      const maxT = pts[pts.length - 1].t || 1;
      const x = (t) => mL + (t / maxT) * plotW;
      return { band, pts, top, dmin, dmax, maxT, x };
    });
    const gdmin = Math.min.apply(null, meta.map((m) => m.dmin)) - 2;
    const gdmax = Math.max.apply(null, meta.map((m) => m.dmax)) + 2;
    meta.forEach((m) => { m.dmin = gdmin; m.dmax = gdmax; m.y = (db) => m.top + hP * (1 - (db - gdmin) / (gdmax - gdmin)); });

    const parts = [
      '<rect width="' + W + '" height="' + H + '" fill="#1a1a1a"/>',
      '<text x="' + mL + '" y="24" fill="#f5f5f5" font-size="16" font-weight="600">' +
        esc(cfg.label) + " — spectral-chaos ribbon</text>"
    ];
    meta.forEach((m) => {
      const { band, pts, top, dmin, dmax, x, y } = m;
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
      // tag-event TICKS along the bottom edge (same events the timeline marks), when tags are given
      events.forEach((ev) => {
        const tm = (ev.t_start + ev.t_end) / 2;
        if (tm < 0 || tm > m.maxT) return;
        const xt = x(tm);
        parts.push('<line x1="' + xt.toFixed(1) + '" y1="' + (top + hP) + '" x2="' + xt.toFixed(1) + '" y2="' + (top + hP - 8) + '" stroke="#dcdcdc" stroke-width="1.1" opacity="0.65"/>');
      });
      parts.push('<rect x="' + mL + '" y="' + top + '" width="' + plotW + '" height="' + hP + '" fill="none" stroke="#888" stroke-width="1"/>');
      parts.push('<text x="' + mL + '" y="' + (top - 8) + '" fill="#dcdcdc" font-size="12">' +
        esc(band.label) + " · level (dB), ribbon width = chaos, hue tonal→chaos" +
        (events.length ? " &middot; ticks = tagged events" : "") + "</text>");
    });

    mount.style.position = "relative";
    mount.innerHTML =
      '<svg id="ribbon-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto;display:block">' +
      parts.join("") + '<g id="ribbon-hover" pointer-events="none"></g></svg>' +
      '<div class="ribbon-tt" style="position:absolute;display:none;pointer-events:none;background:#111;color:#dcdcdc;' +
      'border:1px solid #666;border-radius:5px;padding:6px 9px;font:12px system-ui,sans-serif;line-height:1.5;' +
      'white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,.55);z-index:5;font-variant-numeric:tabular-nums"></div>';

    // ---- hover: guide line + dots at the top/bottom of the chaos band + a value tooltip; near an
    // event tick the tooltip lists that event's tags (so the tags annotate the UI, not just the JSON).
    const svgEl = mount.querySelector("#ribbon-svg");
    const hoverG = mount.querySelector("#ribbon-hover");
    const tt = mount.querySelector(".ribbon-tt");
    function nearest(pts, t) { let best = pts[0], bd = Infinity; for (const p of pts) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } } return best; }
    function nearestEvent(t, maxT) {
      let best = null, bd = Infinity;
      for (const ev of events) { const tm = (ev.t_start + ev.t_end) / 2; if (tm < 0 || tm > maxT) continue; const d = Math.abs(tm - t); if (d < bd) { bd = d; best = { ev: ev, dt: d }; } }
      return best;
    }
    function eventTagsHtml(ev) {
      const names = Object.keys(ev.tags || {});
      let rows = '<div style="color:#9fb7d4;margin-bottom:2px">tagged event · t ' + ((ev.t_start + ev.t_end) / 2).toFixed(1) + "s</div>";
      for (const n of names) {
        const tg = ev.tags[n], gap = (ev.accel_gaps || []).indexOf(n) >= 0;
        rows += "<div>" + esc(n) + " <b>" + tg.value.toFixed(2) + "</b>&middot;" + tg.confidence.toFixed(2) + (gap ? ' <span style="color:#ffb37a">(accel gap)</span>' : "") + "</div>";
      }
      return rows;
    }
    function hideHover() { hoverG.innerHTML = ""; tt.style.display = "none"; }
    svgEl.addEventListener("mousemove", function (e) {
      const r = svgEl.getBoundingClientRect(), scale = r.width / W;
      const sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
      const m = meta.find((mm) => sy >= mm.top && sy <= mm.top + hP);
      if (!m || sx < mL || sx > mL + plotW) { hideHover(); return; }
      const t = (sx - mL) / plotW * m.maxT;
      const p = nearest(m.pts, t), hw = (p.chaos || 0) * CHAOS_DB;
      const xt = m.x(p.t), yUp = m.y(p.level_db + hw), yLo = m.y(p.level_db - hw), yMid = m.y(p.level_db);
      hoverG.innerHTML =
        '<line x1="' + xt.toFixed(1) + '" y1="' + m.top + '" x2="' + xt.toFixed(1) + '" y2="' + (m.top + hP) + '" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>' +
        '<circle cx="' + xt.toFixed(1) + '" cy="' + yUp.toFixed(1) + '" r="3.2" fill="' + hue(p.tonality) + '" stroke="#111" stroke-width="0.8"/>' +
        '<circle cx="' + xt.toFixed(1) + '" cy="' + yLo.toFixed(1) + '" r="3.2" fill="' + hue(p.tonality) + '" stroke="#111" stroke-width="0.8"/>' +
        '<circle cx="' + xt.toFixed(1) + '" cy="' + yMid.toFixed(1) + '" r="2" fill="' + m.band.line + '"/>';
      // pixels-per-second at this band -> a ~6px hit window for "near an event tick"
      const near = nearestEvent(t, m.maxT);
      const nearPx = near ? Math.abs(m.x((near.ev.t_start + near.ev.t_end) / 2) - xt) : Infinity;
      let html = "<b>" + esc(m.band.label) + "</b><br>t " + p.t.toFixed(1) + "s · level <b>" + p.level_db.toFixed(1) +
        "</b> dB<br>chaos <b>" + (p.chaos || 0).toFixed(2) + "</b> · tonality " + (p.tonality == null ? "—" : p.tonality.toFixed(2)) + " · &plusmn;" + hw.toFixed(1) + " dB";
      if (near && nearPx <= 6) html += '<hr style="border:none;border-top:1px solid #444;margin:5px 0">' + eventTagsHtml(near.ev);
      tt.innerHTML = html;
      tt.style.display = "block";
      let left = xt * scale - tt.offsetWidth / 2;
      left = Math.max(2, Math.min(r.width - tt.offsetWidth - 2, left));
      tt.style.left = left.toFixed(0) + "px";
      tt.style.top = ((m.top + hP) * scale + 6).toFixed(0) + "px";
    });
    svgEl.addEventListener("mouseleave", hideHover);
  }

  const api = { drawRibbon: drawRibbon };
  if (typeof window !== "undefined") { window.SensoryNavRibbon = api; }
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}());
