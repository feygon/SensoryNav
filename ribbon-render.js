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
  // Document-level listeners for the R3 stats popover (close on outside-click / Esc). Held at module
  // scope so a re-render (e.g. a second file drop on the analyze page) removes the previous render's
  // handlers before adding new ones, instead of accumulating detached closures.
  let statsDocHandlers = null;
  function drawRibbon(sources, cfg, mount) {
    const sq = sources.squelch;
    if (!sq) { mount.textContent = "no squelch data"; return; }
    const events = (sources.tags && sources.tags.events) || [];
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const bandShort = (label) => label.split(" ")[0]; // "sub-bass 20–80 Hz" -> "sub-bass"
    const BANDS = [
      { key: "subbass", label: "sub-bass 20–80 Hz", line: "#ebd73c" },
      { key: "low", label: "low 80–250 Hz", line: "#5fd35f" },
      { key: "mid", label: "mid 250–1000 Hz", line: "#b98cff" },
      { key: "high", label: "high 1000–4000 Hz", line: "#ff7bac" }
    ].filter((b) => sq[b.key] && sq[b.key].length);
    const CHAOS_DB = 8; // chaos in [0,1] -> ribbon half-width in dB (matches the timeline's CHAOS_DISPLAY_DB)
    const TIPS = {
      subbass: "Sub-bass 20–80 Hz — the engine's firing fundamental and low harmonics; the highest-signal chaos band. A stop reads tonal (blue); rough/broadband road reads chaotic (yellow).",
      low: "Low 80–250 Hz — road rumble, clear of voices. Chaos rises with broadband road texture (gravel, seams, coarse asphalt).",
      mid: "Mid 250 Hz–1 kHz — voices, radio, wind. Chaos here is often cabin/speech noise rather than road.",
      high: "High 1–4 kHz — cargo rattle, consonants, wind hiss; the least road-diagnostic band."
    };
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
    const gdmin = Math.floor(Math.min.apply(null, meta.map((m) => m.dmin)) / 5) * 5; // snap axis to multiples of 5
    const gdmax = Math.ceil(Math.max.apply(null, meta.map((m) => m.dmax)) / 5) * 5;
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
      parts.push('<text x="' + mL + '" y="' + (top - 8) + '" fill="#dcdcdc" font-size="12" style="cursor:help">' +
        "<title>" + esc(TIPS[band.key] || "") + "</title>" +
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

    // ---- R3: whole-trip chaos statistics behind a top-right ⓘ. Computed from the same squelch
    // series already rendered (no re-derivation); null/NaN samples (low-SNR gaps) are excluded.
    function chaosStats(vals) {
      const a = vals.filter((v) => v != null && !isNaN(v)).sort((x, y) => x - y);
      const n = a.length; if (!n) return null;
      const median = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
      const peak = a[n - 1];
      const mean = a.reduce((s, v) => s + v, 0) / n;
      const std = Math.sqrt(a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n);
      const B = 20, cnt = new Array(B).fill(0); // mode = midpoint of the most-populated 0.05-wide bin
      a.forEach((v) => { let bi = Math.floor(v / 0.05); if (bi < 0) bi = 0; if (bi >= B) bi = B - 1; cnt[bi]++; });
      let mb = 0; for (let i = 1; i < B; i++) if (cnt[i] > cnt[mb]) mb = i;
      return { median: median, mode: mb * 0.05 + 0.025, peak: peak, std: std, n: n };
    }
    // per-band chaos series
    const statRows = BANDS.map((b) => ({ name: bandShort(b.label), color: b.line, s: chaosStats(sq[b.key].map((p) => p.chaos)) }));
    // total (weighted): the felt composite low0.6/mid0.3/high0.1 (matches CONSTANTS.WEIGHTS; sub-bass
    // is the separately-shown fold, not part of the composite), computed per time index then summarised.
    if (sq.low && sq.mid && sq.high) {
      const L = Math.min(sq.low.length, sq.mid.length, sq.high.length), comp = [];
      for (let i = 0; i < L; i++) {
        const a = sq.low[i].chaos, b = sq.mid[i].chaos, c = sq.high[i].chaos;
        if (a == null || b == null || c == null || isNaN(a) || isNaN(b) || isNaN(c)) continue;
        comp.push(0.6 * a + 0.3 * b + 0.1 * c);
      }
      statRows.push({ name: "total · weighted", color: "#dcdcdc", s: chaosStats(comp), rule: true });
    }
    // total (pooled): every band's samples thrown into one unweighted pool
    const pooled = []; BANDS.forEach((b) => sq[b.key].forEach((p) => pooled.push(p.chaos)));
    statRows.push({ name: "total · pooled", color: "#888", s: chaosStats(pooled) });

    const f3 = (v) => (v == null ? "—" : v.toFixed(3));
    let statTbl = '<table style="border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12px">' +
      '<thead><tr style="color:#9fb7d4;text-align:right">' +
      '<th style="text-align:left;padding:2px 8px 4px 0">band</th><th style="padding:2px 8px 4px">median</th>' +
      '<th style="padding:2px 8px 4px">mode<span style="color:#7f8a97">¹</span></th><th style="padding:2px 8px 4px">peak</th>' +
      '<th style="padding:2px 8px 4px">σ</th><th style="padding:2px 0 4px 8px">n</th></tr></thead><tbody>';
    statRows.forEach((r) => {
      const s = r.s, bt = r.rule ? "border-top:1px solid #4a4a4a;" : "";
      statTbl += '<tr style="text-align:right;' + bt + '"><td style="text-align:left;padding:2px 8px 2px 0;' + bt + '">' +
        '<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:' + r.color + '"></span>' +
        esc(r.name) + '</td><td style="padding:2px 8px;' + bt + '">' + f3(s && s.median) + '</td><td style="padding:2px 8px;' + bt + '">' +
        f3(s && s.mode) + '</td><td style="padding:2px 8px;' + bt + '">' + f3(s && s.peak) + '</td><td style="padding:2px 8px;' + bt + '">' +
        f3(s && s.std) + '</td><td style="padding:2px 0 2px 8px;' + bt + '">' + (s ? s.n : "—") + "</td></tr>";
    });
    statTbl += '</tbody></table><div style="color:#7f8a97;font-size:10.5px;margin-top:6px;max-width:340px;line-height:1.45">' +
      '¹ mode = midpoint of the most-populated 0.05-wide chaos bin. Chaos = 1&minus;tonality (0 tonal → 1 chaotic). ' +
      'Weighted total uses the low0.6/mid0.3/high0.1 composite; pooled throws all four bands into one set.</div>';

    mount.insertAdjacentHTML("beforeend",
      '<button type="button" id="ribbon-stats-btn" title="Whole-trip chaos statistics" aria-label="Whole-trip chaos statistics" ' +
      'style="position:absolute;top:2px;right:6px;z-index:6;width:22px;height:22px;border-radius:50%;border:1px solid #6a6a6a;' +
      'background:#2a2a2a;color:#dcdcdc;font:600 13px system-ui,sans-serif;cursor:pointer;line-height:20px;padding:0">&#9432;</button>' +
      '<div id="ribbon-stats" role="dialog" aria-label="Chaos statistics" style="position:absolute;top:28px;right:6px;z-index:7;display:none;' +
      'background:#1b1b1b;color:#dcdcdc;border:1px solid #555;border-radius:8px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.6);' +
      'font-family:system-ui,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:8px">' +
      '<b style="font-size:13px">Spectral-chaos statistics · whole trip</b>' +
      '<span id="ribbon-stats-x" style="cursor:pointer;color:#9aa2ac;font-size:16px;line-height:1">&times;</span></div>' +
      statTbl + "</div>");
    const statBtn = mount.querySelector("#ribbon-stats-btn"), statBox = mount.querySelector("#ribbon-stats");
    function openStats(v) { statBox.style.display = v ? "block" : "none"; }
    statBtn.addEventListener("click", function (e) { e.stopPropagation(); openStats(statBox.style.display === "none"); });
    mount.querySelector("#ribbon-stats-x").addEventListener("click", function () { openStats(false); });
    statBox.addEventListener("click", function (e) { e.stopPropagation(); });
    // Remove the previous render's document handlers before registering this render's, so repeated
    // draws don't leak listeners bound to now-detached stat boxes.
    if (statsDocHandlers) { document.removeEventListener("click", statsDocHandlers.click); document.removeEventListener("keydown", statsDocHandlers.key); }
    const onDocClick = function () { openStats(false); };
    const onDocKey = function (e) { if (e.key === "Escape") openStats(false); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onDocKey);
    statsDocHandlers = { click: onDocClick, key: onDocKey };

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
    const TICK_SNAP_PX = 9; // snap the crosshair to an event tick when the cursor is within this many px of it
    svgEl.addEventListener("mousemove", function (e) {
      const r = svgEl.getBoundingClientRect(), scale = r.width / W;
      const sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
      const hovered = meta.find((mm) => sy >= mm.top && sy <= mm.top + hP);
      if (!hovered || sx < mL || sx > mL + plotW) { hideHover(); return; }
      const rawT = (sx - mL) / plotW * hovered.maxT;
      // R1: near the BASE of a band, snap the crosshair to the nearest event tick (matches the
      // timeline model: values track the line, events snap at the base). Elsewhere track the cursor.
      const nearBase = sy >= hovered.top + hP - 10;
      const evNear = nearestEvent(rawT, hovered.maxT);
      const evPx = evNear ? Math.abs(hovered.x((evNear.ev.t_start + evNear.ev.t_end) / 2) - sx) : Infinity;
      const snappedEvent = (nearBase && evNear && evPx <= TICK_SNAP_PX) ? evNear.ev : null;
      const snapT = snappedEvent ? (snappedEvent.t_start + snappedEvent.t_end) / 2 : rawT;
      // R2: draw the guide segment + dots on EVERY band at the same (snapped) time, and list every
      // band's value in one tooltip — hovering any band reads them all at that instant. ONE shared
      // crosshair x (from the hovered band) keeps the vertical line straight even if the bands' time
      // grids differ slightly (sub-bass can be one sample shorter than low/mid/high).
      const xC = hovered.x(nearest(hovered.pts, snapT).t);
      let g = "", rows = "";
      meta.forEach((m) => {
        const p = nearest(m.pts, snapT), hw = (p.chaos || 0) * CHAOS_DB;
        const yUp = m.y(p.level_db + hw), yLo = m.y(p.level_db - hw), yMid = m.y(p.level_db);
        const on = m === hovered, lineOp = snappedEvent ? 0.5 : (on ? 0.4 : 0.22);
        g += '<line x1="' + xC.toFixed(1) + '" y1="' + m.top + '" x2="' + xC.toFixed(1) + '" y2="' + (m.top + hP) +
          '" stroke="rgba(255,255,255,' + lineOp + ')" stroke-width="1"/>' +
          '<circle cx="' + xC.toFixed(1) + '" cy="' + yUp.toFixed(1) + '" r="3.2" fill="' + hue(p.tonality) + '" stroke="#111" stroke-width="0.8"/>' +
          '<circle cx="' + xC.toFixed(1) + '" cy="' + yLo.toFixed(1) + '" r="3.2" fill="' + hue(p.tonality) + '" stroke="#111" stroke-width="0.8"/>' +
          '<circle cx="' + xC.toFixed(1) + '" cy="' + yMid.toFixed(1) + '" r="2" fill="' + m.band.line + '"/>';
        rows += '<div' + (on ? ' style="color:#fff"' : '') + '><span style="display:inline-block;width:9px;height:9px;border-radius:2px;vertical-align:baseline;margin-right:5px;background:' +
          m.band.line + '"></span>' + esc(bandShort(m.band.label)) + ' <b>' + p.level_db.toFixed(1) + '</b> dB · chaos <b>' +
          (p.chaos || 0).toFixed(2) + '</b> · ton ' + (p.tonality == null ? "—" : p.tonality.toFixed(2)) + "</div>";
      });
      hoverG.innerHTML = g;
      let html = '<div style="color:#9fb7d4;margin-bottom:3px">t <b>' + snapT.toFixed(1) + "</b> s</div>" + rows;
      if (snappedEvent) html += '<hr style="border:none;border-top:1px solid #444;margin:5px 0">' + eventTagsHtml(snappedEvent);
      tt.innerHTML = html;
      tt.style.display = "block";
      let left = xC * scale - tt.offsetWidth / 2;
      left = Math.max(2, Math.min(r.width - tt.offsetWidth - 2, left));
      tt.style.left = left.toFixed(0) + "px";
      tt.style.top = ((hovered.top + hP) * scale + 6).toFixed(0) + "px";
    });
    svgEl.addEventListener("mouseleave", hideHover);
  }

  const api = { drawRibbon: drawRibbon };
  if (typeof window !== "undefined") { window.SensoryNavRibbon = api; }
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
}());
