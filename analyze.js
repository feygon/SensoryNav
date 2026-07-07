// analyze.js — client-side intake for a capture (WAV + JSON sidecar).
// Everything here runs in the browser: files are read locally, never uploaded.
(function () {
  "use strict";

  const el = {
    wav: document.getElementById("wav-input"),
    json: document.getElementById("json-input"),
    wavDrop: document.getElementById("wav-drop"),
    jsonDrop: document.getElementById("json-drop"),
    summary: document.getElementById("summary"),
    status: document.getElementById("status"),
    analysisStatus: document.getElementById("analysis-status"),
    chart: document.getElementById("chart")
  };
  const picked = { wav: null, json: null };

  // --- WAV: parse just the header (sample rate / channels / duration), no decode of samples ---
  function parseWavHeader(buffer) {
    const v = new DataView(buffer);
    const ascii = (o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
    if (v.byteLength < 12 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("not a WAV file");
    let off = 12, fmt = null, dataSize = null;
    while (off + 8 <= v.byteLength) {
      const id = ascii(off, 4), size = v.getUint32(off + 4, true);
      if (id === "fmt ") fmt = { channels: v.getUint16(off + 10, true), sampleRate: v.getUint32(off + 12, true), bits: v.getUint16(off + 22, true) };
      else if (id === "data") { dataSize = size; break; }
      off += 8 + size + (size % 2);
    }
    if (!fmt || dataSize == null) throw new Error("malformed WAV (missing fmt/data chunk)");
    const bytesPerSample = fmt.bits / 8;
    const durationSec = dataSize / (fmt.sampleRate * fmt.channels * bytesPerSample);
    return { sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits, durationSec: durationSec };
  }

  // --- JSON: validate the capture sidecar and pull a quick summary ---
  function summarizeSidecar(obj) {
    const out = { schema: obj.schema, valid: obj.schema === "sensorynav-capture-v1" };
    out.durationSec = obj.duration_ms != null ? obj.duration_ms / 1000 : null;
    out.wavFilename = obj.audio && obj.audio.wav_filename;
    out.sampleRate = obj.audio && obj.audio.sample_rate;
    const fixes = obj.gps_samples || [];
    out.fixCount = fixes.length;
    const speeds = fixes.map((f) => f.speed_mps).filter((s) => s != null && isFinite(s));
    out.speedRange = speeds.length ? [Math.min.apply(null, speeds), Math.max.apply(null, speeds)] : null;
    return out;
  }

  const fmtSec = (s) => (s == null ? "—" : (s >= 60 ? Math.floor(s / 60) + " min " + Math.round(s % 60) + " s" : s.toFixed(1) + " s"));

  function render() {
    if (!picked.wav && !picked.json) { el.summary.hidden = true; return; }
    const rows = [];
    if (picked.wav) {
      const w = picked.wav;
      rows.push(["WAV file", w.name]);
      if (w.header) rows.push(["Audio", w.header.sampleRate.toLocaleString() + " Hz · " + w.header.channels + " ch · " + w.header.bits + "-bit · " + fmtSec(w.header.durationSec)]);
      else if (w.error) rows.push(["Audio", "⚠ " + w.error]);
    }
    if (picked.json) {
      const j = picked.json;
      rows.push(["JSON sidecar", j.name]);
      if (j.info) {
        rows.push(["Schema", (j.info.valid ? "✓ " : "⚠ ") + (j.info.schema || "unknown")]);
        rows.push(["Duration", fmtSec(j.info.durationSec)]);
        rows.push(["GPS fixes", j.info.fixCount + (j.info.speedRange ? " · " + j.info.speedRange[0].toFixed(1) + "–" + j.info.speedRange[1].toFixed(1) + " m/s" : "")]);
      } else if (j.error) rows.push(["JSON", "⚠ " + j.error]);
    }
    // cross-check the pair
    if (picked.wav && picked.wav.header && picked.json && picked.json.info) {
      const sameName = picked.json.info.wavFilename === picked.wav.name;
      const dw = picked.wav.header.durationSec, dj = picked.json.info.durationSec;
      const durClose = dw != null && dj != null && Math.abs(dw - dj) < 2;
      rows.push(["Pair check", (sameName ? "✓ names match" : "⚠ sidecar names " + (picked.json.info.wavFilename || "?")) + " · " + (durClose ? "✓ durations align" : "⚠ durations differ")]);
    }
    el.summary.innerHTML = "<h2>Local read</h2>" +
      "<table>" + rows.map((r) => "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>").join("") + "</table>" +
      "<p class=\"note\">Read entirely in your browser — nothing was uploaded. Spectral-chaos analysis runs below, on-device; speed-conditioned roughness and event tags are the next layer.</p>";
    el.summary.hidden = false;
  }

  function readWav(file) {
    picked.wav = { name: file.name };
    const r = new FileReader();
    r.onload = () => { try { picked.wav.header = parseWavHeader(r.result); } catch (e) { picked.wav.error = e.message; } render(); };
    r.onerror = () => { picked.wav.error = "could not read file"; render(); };
    r.readAsArrayBuffer(file.slice(0, 4096)); // header first (quick summary) — full decode happens in the worker
    startAnalysis(file);
  }

  // --- decode + score on-device, in a worker so a long capture doesn't freeze the page ---
  let worker = null;
  function startAnalysis(file) {
    el.chart.hidden = true;
    el.analysisStatus.textContent = "Decoding and scoring on your device… (a long capture can take a few seconds)";
    const r = new FileReader();
    r.onload = () => {
      try {
        if (worker) worker.terminate();
        worker = new Worker("analyze-worker.js");
        worker.onmessage = (ev) => {
          const d = ev.data;
          if (!d.ok) { el.analysisStatus.textContent = "Could not analyze the audio: " + d.error; return; }
          el.analysisStatus.textContent = "";
          renderChart(d.squelch);
        };
        worker.onerror = (ev) => { el.analysisStatus.textContent = "Analysis error: " + (ev.message || "worker failed to load"); };
        worker.postMessage({ wav: r.result }, [r.result]); // transfer the buffer, no copy
      } catch (e) { el.analysisStatus.textContent = "Analysis unavailable in this browser: " + e.message; }
    };
    r.onerror = () => { el.analysisStatus.textContent = "Could not read the audio file for analysis."; };
    r.readAsArrayBuffer(file);
  }

  // tonal (blue) -> chaotic (yellow); CVD-safe, thickness carries chaos too
  function hue(tonality) {
    const t = Math.max(0, Math.min(1, 1 - (tonality == null ? 0.5 : tonality)));
    const a = [58, 111, 216], b = [235, 215, 60];
    return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
  }
  function renderChart(sq) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const BANDS = [
      { key: "subbass", label: "sub-bass 20–80 Hz", line: "#ebd73c" },
      { key: "low", label: "low 80–250 Hz", line: "#5fd35f" },
      { key: "mid", label: "mid 250–1000 Hz", line: "#b98cff" },
      { key: "high", label: "high 1000–4000 Hz", line: "#ff7bac" }
    ].filter((b) => sq[b.key] && sq[b.key].length);
    const CHAOS_DB = 8, W = 1180, mL = 54, mR = 16, plotW = W - mL - mR, top0 = 18, hP = 116, gap = 40;
    const H = top0 + BANDS.length * (hP + gap);
    const parts = ['<rect width="' + W + '" height="' + H + '" fill="#141414"/>'];
    BANDS.forEach((band, bi) => {
      const pts = sq[band.key], top = top0 + bi * (hP + gap);
      let dmin = Infinity, dmax = -Infinity;
      pts.forEach((p) => { const hw = (p.chaos || 0) * CHAOS_DB; dmin = Math.min(dmin, p.level_db - hw); dmax = Math.max(dmax, p.level_db + hw); });
      dmin -= 2; dmax += 2;
      const maxT = pts[pts.length - 1].t || 1, x = (t) => mL + (t / maxT) * plotW, y = (db) => top + hP * (1 - (db - dmin) / (dmax - dmin)), bw = Math.max(1, plotW / pts.length);
      for (let db = Math.ceil(dmin / 10) * 10; db <= dmax; db += 10) {
        parts.push('<line x1="' + mL + '" y1="' + y(db).toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + y(db).toFixed(1) + '" stroke="#333" stroke-width="0.6"/>');
        parts.push('<text x="' + (mL - 6) + '" y="' + (y(db) + 3).toFixed(1) + '" fill="#888" font-size="10" text-anchor="end">' + db + "</text>");
      }
      let line = "";
      pts.forEach((p) => {
        const hw = (p.chaos || 0) * CHAOS_DB, yt = y(p.level_db + hw), yb = y(p.level_db - hw);
        parts.push('<rect x="' + (x(p.t) - bw / 2).toFixed(2) + '" y="' + yt.toFixed(1) + '" width="' + bw.toFixed(2) + '" height="' + Math.max(0.4, yb - yt).toFixed(1) + '" fill="' + hue(p.tonality) + '" opacity="0.5"/>');
        line += x(p.t).toFixed(1) + "," + y(p.level_db).toFixed(1) + " ";
      });
      parts.push('<polyline fill="none" stroke="' + band.line + '" stroke-width="1.2" points="' + line.trim() + '"/>');
      parts.push('<text x="' + mL + '" y="' + (top - 5) + '" fill="#dcdcdc" font-size="11">' + esc(band.label) + " &middot; level (dB), ribbon width = chaos, hue tonal&rarr;chaos</text>");
    });
    el.chart.innerHTML = "<h2>Spectral-chaos analysis</h2>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto" font-family="system-ui,sans-serif">' + parts.join("") + "</svg>" +
      '<p class="cnote">Computed on-device from your audio. Hue: <span style="color:#3a6fd8">tonal</span> (engine/steady) &rarr; <span style="color:#ebd73c">chaotic</span> (road/broadband); line thickness carries chaos too.</p>';
    el.chart.hidden = false;
  }
  function readJson(file) {
    picked.json = { name: file.name };
    const r = new FileReader();
    r.onload = () => { try { picked.json.info = summarizeSidecar(JSON.parse(r.result)); } catch (e) { picked.json.error = "not valid JSON"; } render(); };
    r.onerror = () => { picked.json.error = "could not read file"; render(); };
    r.readAsText(file);
  }

  function accept(file) {
    if (!file) return;
    if (/\.wav$/i.test(file.name) || file.type === "audio/wav") readWav(file);
    else if (/\.json$/i.test(file.name) || file.type === "application/json") readJson(file);
    else el.status.textContent = "Unsupported file: " + file.name + " (expected a .wav or .json)";
  }

  // wire file inputs + drag-drop zones
  el.wav.addEventListener("change", (e) => accept(e.target.files[0]));
  el.json.addEventListener("change", (e) => accept(e.target.files[0]));
  [el.wavDrop, el.jsonDrop].forEach((zone) => {
    if (!zone) return;
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); for (const f of e.dataTransfer.files) accept(f); });
  });
}());
