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
      "<p class=\"note\">Read entirely in your browser — nothing was uploaded. Speed, roughness, and spectral-chaos are computed below, on-device; event tags are the next layer.</p>";
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
  let worker = null, lastSquelch = null;
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
          lastSquelch = d.squelch;
          showRibbon();
        };
        worker.onerror = (ev) => { el.analysisStatus.textContent = "Analysis error: " + (ev.message || "worker failed to load"); };
        worker.postMessage({ wav: r.result }, [r.result]); // transfer the buffer, no copy
      } catch (e) { el.analysisStatus.textContent = "Analysis unavailable in this browser: " + e.message; }
    };
    r.onerror = () => { el.analysisStatus.textContent = "Could not read the audio file for analysis."; };
    r.readAsArrayBuffer(file);
  }

  // Render via the SHARED ribbon renderer (ribbon-render.js) — the exact code behind
  // out/score/ribbon-*.html — so the analyze output is byte-identical, not a second copy.
  function showRibbon() {
    if (!lastSquelch || !window.SensoryNavRibbon) return;
    const label = (picked.wav && picked.wav.name) || "capture";
    window.SensoryNavRibbon.drawRibbon({ squelch: lastSquelch }, { label: label }, el.chart);
    el.chart.hidden = false;
  }
  function readJson(file) {
    picked.json = { name: file.name };
    const r = new FileReader();
    r.onload = () => {
      try { picked.json.obj = JSON.parse(r.result); picked.json.info = summarizeSidecar(picked.json.obj); }
      catch (e) { picked.json.error = "not valid JSON"; }
      render();
    };
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
