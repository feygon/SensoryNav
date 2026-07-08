// analyze.js — client-side intake for a capture (WAV + JSON sidecar), then FULL on-device scoring.
// Everything here runs in the browser: files are read locally, the audio is decoded + scored in a
// background Worker (analyze-worker.js) into the same {scored,hires,squelch,tags} a research pass
// produces, and rendered with the SHARED timeline + ribbon renderers. The audio is never uploaded
// and never persisted — only the derived features are used.
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
    legendWrap: document.getElementById("legend-wrap"),
    timelineWrap: document.getElementById("timeline-wrap"),
    ribbonWrap: document.getElementById("ribbon-wrap"),
    ribbonChart: document.getElementById("ribbon-chart")
  };
  const picked = { wav: null, json: null };
  let worker = null, registry = null, lastResult = null;

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

  // Emoji gutter: a small icon that ties a stat to the viz element it feeds (so the local-read
  // is a legend for what's below, not just a wall of numbers).
  const rico = (e) => "<span class=\"rico\">" + e + "</span>";

  function render() {
    if (!picked.wav && !picked.json) { el.summary.hidden = true; return; }
    const rows = [];
    if (picked.wav) {
      const w = picked.wav;
      rows.push([rico("🎧") + "WAV file", w.name]);
      if (w.header) rows.push([rico("🔊") + "Audio", w.header.sampleRate.toLocaleString() + " Hz · " + w.header.channels + " ch · " + w.header.bits + "-bit · " + fmtSec(w.header.durationSec)]);
      else if (w.error) rows.push([rico("🔊") + "Audio", "⚠ " + w.error]);
    }
    if (picked.json) {
      const j = picked.json;
      rows.push([rico("🧾") + "JSON sidecar", j.name]);
      if (j.info) {
        rows.push([rico("🏷️") + "Schema", (j.info.valid ? "✓ " : "⚠ ") + (j.info.schema || "unknown")]);
        rows.push([rico("⏱️") + "Duration", fmtSec(j.info.durationSec) + " <span class=\"pt\">→ timeline x-axis</span>"]);
        rows.push([rico("🛰️") + "GPS fixes", j.info.fixCount + (j.info.speedRange ? " · " + j.info.speedRange[0].toFixed(1) + "–" + j.info.speedRange[1].toFixed(1) + " m/s <span class=\"pt\">→ 🔵 speed line</span>" : "")]);
      } else if (j.error) rows.push([rico("🧾") + "JSON", "⚠ " + j.error]);
    }
    if (picked.wav && picked.wav.header && picked.json && picked.json.info) {
      const sameName = picked.json.info.wavFilename === picked.wav.name;
      const dw = picked.wav.header.durationSec, dj = picked.json.info.durationSec;
      const durClose = dw != null && dj != null && Math.abs(dw - dj) < 2;
      rows.push([rico("🔗") + "Pair check", (sameName ? "✓ names match" : "⚠ sidecar names " + (picked.json.info.wavFilename || "?")) + " · " + (durClose ? "✓ durations align" : "⚠ durations differ")]);
    }
    el.summary.innerHTML = "<h2>Local read</h2>" +
      "<table><tbody>" + rows.map((r) => "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>").join("") + "</tbody></table>" +
      "<p class=\"note\">Read entirely in your browser — nothing was uploaded. Drop both files to score on-device.</p>";
    el.summary.hidden = false;
  }

  function readWav(file) {
    picked.wav = { name: file.name, file: file };
    const r = new FileReader();
    r.onload = () => { try { picked.wav.header = parseWavHeader(r.result); } catch (e) { picked.wav.error = e.message; } render(); maybeAnalyze(); };
    r.onerror = () => { picked.wav.error = "could not read file"; render(); };
    r.readAsArrayBuffer(file.slice(0, 4096)); // header first for the summary; the worker gets the full file
  }

  function readJson(file) {
    picked.json = { name: file.name, file: file };
    const r = new FileReader();
    r.onload = () => {
      try { picked.json.obj = JSON.parse(r.result); picked.json.info = summarizeSidecar(picked.json.obj); }
      catch (e) { picked.json.error = "not valid JSON"; }
      render(); maybeAnalyze();
    };
    r.onerror = () => { picked.json.error = "could not read file"; render(); };
    r.readAsText(file);
  }

  // The full pipeline needs BOTH the audio (samples) and the sidecar (GPS + audio_first_frame_ms),
  // so scoring only starts once both are present and valid.
  function maybeAnalyze() {
    if (!picked.wav || !picked.wav.file || picked.wav.error) return;
    if (!picked.json || !picked.json.obj || picked.json.error) return;
    startAnalysis(picked.wav.file, picked.json.obj);
  }

  // Fetch the tag registry once (a small deidentified JSON of tag definitions) so the worker can
  // extract event tags without any filesystem access.
  function ensureRegistry() {
    if (registry) return Promise.resolve(registry);
    return fetch("harness/tags/registry.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => { registry = r; return r; })
      .catch(() => { registry = null; return null; });
  }

  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("could not read the audio file for analysis"));
      r.readAsArrayBuffer(file);
    });
  }

  function startAnalysis(wavFile, sidecar) {
    el.legendWrap.hidden = true;
    el.timelineWrap.hidden = true;
    el.ribbonWrap.hidden = true;
    el.analysisStatus.textContent = "Decoding and scoring on your device… (a long capture can take several seconds)";
    Promise.all([readArrayBuffer(wavFile), ensureRegistry()]).then(function (vals) {
      const wavBuf = vals[0], reg = vals[1];
      try {
        if (worker) worker.terminate();
        worker = new Worker("analyze-worker.js");
        worker.onmessage = function (ev) {
          const d = ev.data;
          if (!d || !d.ok) { el.analysisStatus.textContent = "Could not analyze the audio: " + ((d && d.error) || "unknown error"); return; }
          el.analysisStatus.textContent = "";
          lastResult = d;
          showTimeline(wavFile);
          showRibbon();
        };
        worker.onerror = function (ev) { el.analysisStatus.textContent = "Analysis error: " + (ev.message || "worker failed to load"); };
        worker.postMessage({ wav: wavBuf, sidecar: sidecar, registry: reg }, [wavBuf]); // transfer the buffer, no copy
      } catch (e) { el.analysisStatus.textContent = "Analysis unavailable in this browser: " + e.message; }
    }).catch(function (e) { el.analysisStatus.textContent = e.message; });
  }

  // Audio playback is localhost-only (raw research capture must not leave the machine). Off
  // localhost we pass no audioUrl, so the renderer hides Play and creates no object-URL.
  function isLocal() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }

  // Render the stacked timeline via the SHARED renderer (timeline-render.js) — the exact code behind
  // out/score/timeline-*.html — so the analyze output is byte-identical, not a second copy.
  function showTimeline(wavFile) {
    if (!lastResult || !window.SensoryNavTimeline) return;
    const label = (picked.wav && picked.wav.name) || "capture";
    const audioUrl = isLocal() ? URL.createObjectURL(wavFile) : null;
    el.legendWrap.hidden = false;
    el.timelineWrap.hidden = false;
    window.SensoryNavTimeline.drawTimeline(
      { scored: lastResult.scored, hires: lastResult.hires, squelch: lastResult.squelch, tags: lastResult.tags },
      { label: label, audioUrl: audioUrl, bandsOn: true, envelopeOn: false }
    );
  }

  // Per-band chaos ribbon via the SHARED ribbon renderer — ALL FOUR bands (sub-bass is the
  // highest-signal chaos section, so it stays). All bands share one dB axis so the spectral lines
  // are directly comparable. Tags are passed so the ribbon marks the same tag-events the timeline does.
  function showRibbon() {
    if (!lastResult || !window.SensoryNavRibbon || !el.ribbonChart) return;
    const label = (picked.wav && picked.wav.name) || "capture";
    window.SensoryNavRibbon.drawRibbon({ squelch: lastResult.squelch, tags: lastResult.tags }, { label: label }, el.ribbonChart);
    el.ribbonWrap.hidden = false;
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

  // If we arrived from the capture page's "Analyze upon stopping", the WAV + sidecar were stashed in
  // IndexedDB — take them (one-shot) and feed them straight into the same intake as a manual drop.
  if (window.SensoryNavHandoff && window.SensoryNavHandoff.takeHandoff) {
    window.SensoryNavHandoff.takeHandoff().then((rec) => {
      if (!rec || !rec.wavBlob || !rec.manifest) return;
      el.status.textContent = "Loaded your recording from the recorder — analyzing on your device…";
      const wavFile = new File([rec.wavBlob], rec.wavName || "capture.wav", { type: "audio/wav" });
      const jsonFile = new File([JSON.stringify(rec.manifest)], rec.jsonName || "capture.json", { type: "application/json" });
      accept(jsonFile);
      accept(wavFile);
    });
  }
}());
