// capture.js
(function () {
  "use strict";
  const core = window.SensoryNavCore;

  // Mic processing-off request — recorded into the sidecar verbatim so the
  // capture can be checked against the device's actually-applied settings.
  // Single source of truth: the getUserMedia constraints AND the manifest's
  // audio_settings_requested share this object, so they can never drift apart.
  const REQUESTED_AUDIO = Object.freeze({
    autoGainControl: false,
    noiseSuppression: false,
    echoCancellation: false
  });

  // Tuning constants, named and gathered here rather than scattered as bare
  // magic numbers through the handlers.
  const CONFIG = Object.freeze({
    vuScale: 4,              // maps worklet RMS to the 0..1 level bar
    gpsTimeoutMs: 30000,     // watchPosition: max wait per fix
    gpsMaximumAgeMs: 0,      // never accept a cached fix — we want live motion
    objectUrlRevokeMs: 1000  // delay before revoking a finished download URL
  });

  // All warning-banner copy in one place. (The output sites stay where their
  // events happen; only the text is centralized.)
  const WARNINGS = Object.freeze({
    processingOn: "Warning: this device did not honor processing-off. Captures may be gain-normalized.",
    backgrounded: "Warning: app backgrounded — capture is paused/at risk. Return to the page.",
    noGps: "Warning: this pass captured no GPS fixes."
  });

  const state = {
    name: "idle",
    frames: [],
    totalSamples: 0,
    sampleRate: 0,
    gpsSamples: [],
    gpsCounter: 0,
    recordingStartMs: 0,
    passTimestamp: "",
    audioFirstFrameMs: 0,
    audioContext: null,
    workletNode: null,
    mediaStream: null,
    geoWatchId: null,
    wakeLock: null,
    appliedSettings: null,
    baseLabel: "johnson-creek-pass-1"
  };

  let ui = {};

  function init() {
    ui = {
      start: document.getElementById("start"),
      stop: document.getElementById("stop"),
      status: document.getElementById("status"),
      level: document.getElementById("level"),
      gps: document.getElementById("gps"),
      notes: document.getElementById("notes"),
      label: document.getElementById("label"),
      warning: document.getElementById("warning"),
      trimStart: document.getElementById("trim-start"),
      trimEnd: document.getElementById("trim-end")
    };
    ui.start.addEventListener("click", onStart);
    ui.stop.addEventListener("click", onStop);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }

  function transition(event) {
    const next = core.nextState(state.name, event);
    if (next === null) {
      return false;
    }
    state.name = next;
    render();
    return true;
  }

  async function onStart() {
    if (!transition("start")) { return; }
    try {
      await requestStreams();
    } catch (err) {
      showError(err);
      transition("denied");
      return;
    }
    transition("granted");
    try {
      await startRecording();
    } catch (err) {
      showError(err);
      stopStreams();
      transition("stream_lost");
    }
  }

  async function requestStreams() {
    if (!window.isSecureContext) {
      throw new Error("Insecure context — open over HTTPS.");
    }
    const constraints = { audio: REQUESTED_AUDIO };
    state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    state.appliedSettings = state.mediaStream.getAudioTracks()[0].getSettings();
    warnIfProcessingOn(state.appliedSettings);
    state.mediaStream.getAudioTracks()[0].addEventListener("ended", () => streamLost("mic_lost"));
  }

  function warnIfProcessingOn(applied) {
    const on = applied.autoGainControl || applied.noiseSuppression || applied.echoCancellation;
    ui.warning.textContent = on ? WARNINGS.processingOn : "";
  }

  async function startRecording() {
    state.recordingStartMs = Date.now();
    state.passTimestamp = hhmmss(new Date());
    state.frames = [];
    state.totalSamples = 0;
    state.gpsSamples = [];
    state.gpsCounter = 0;
    state.audioFirstFrameMs = 0;

    state.audioContext = new AudioContext();
    state.sampleRate = state.audioContext.sampleRate;
    await state.audioContext.audioWorklet.addModule("capture-worklet.js");
    const source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.workletNode = new AudioWorkletNode(state.audioContext, "capture-processor");
    state.workletNode.port.onmessage = onAudioFrame;
    source.connect(state.workletNode);
    // Do not connect to destination — we are not monitoring playback.

    startGpsWatch();
    await acquireWakeLock();
    render();
  }

  function onAudioFrame(event) {
    if (state.name !== "recording") { return; }
    const { frame, rms } = event.data;
    if (state.audioFirstFrameMs === 0) {
      state.audioFirstFrameMs = Date.now();
    }
    state.frames.push(frame);
    state.totalSamples += frame.length;
    ui.level.value = Math.min(1, rms * CONFIG.vuScale); // simple VU scaling
  }

  function startGpsWatch() {
    state.geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        state.gpsCounter += 1;
        state.gpsSamples.push(core.normalizeFix(position, "g" + state.gpsCounter));
        ui.gps.textContent = "GPS locked — " + state.gpsSamples.length + " fixes, " +
          (position.coords.speed == null ? "?" : position.coords.speed.toFixed(1)) + " m/s";
      },
      (err) => { ui.gps.textContent = "GPS error: " + err.message; },
      { enableHighAccuracy: true, maximumAge: CONFIG.gpsMaximumAgeMs, timeout: CONFIG.gpsTimeoutMs }
    );
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
      }
    } catch (err) {
      // Non-fatal; screen may dim.
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
  }

  function onVisibility() {
    if (state.name !== "recording") { return; }
    if (document.hidden) {
      transition("foreground_lost");
      ui.warning.textContent = WARNINGS.backgrounded;
    } else if (state.wakeLock === null) {
      acquireWakeLock();
    }
  }

  function onStop() {
    if (state.name !== "recording") { return; }
    transition("stop");
    finalizeAndExport(null);
  }

  function finalizeAndExport(reason) {
    stopStreams();

    // Optional deidentifying trims, applied HERE so the removed audio + GPS never reach a
    // saved file. If a checked trim would leave nothing, warn and save nothing (saving the
    // untrimmed capture would leak exactly what the user asked to remove).
    const dropFirstSec = ui.trimStart && ui.trimStart.checked ? 30 : 0;
    const dropLastSec = ui.trimEnd && ui.trimEnd.checked ? 30 : 0;
    let src = {
      frames: state.frames,
      totalSamples: state.totalSamples,
      sampleRate: state.sampleRate,
      recordingStartMs: state.recordingStartMs,
      audioFirstFrameMs: state.audioFirstFrameMs,
      gpsSamples: state.gpsSamples
    };
    if (dropFirstSec || dropLastSec) {
      const trimmed = core.trimCapture(src, { dropFirstSec, dropLastSec });
      if (trimmed === null) {
        ui.warning.textContent = "Recording too short to remove " + (dropFirstSec + dropLastSec) + " s — nothing was saved.";
        return;
      }
      src = trimmed;
    }

    const label = (ui.label.value || state.baseLabel) + "-" + state.passTimestamp;
    const wavName = label + ".wav";
    const wav = core.encodeWav(src.frames, src.totalSamples, src.sampleRate);
    const manifest = core.buildManifest({
      pass_label: label,
      wav_filename: wavName,
      recording_start_ms: src.recordingStartMs,
      audio_first_frame_ms: src.audioFirstFrameMs,
      total_samples: src.totalSamples,
      sample_rate: src.sampleRate,
      partial: reason !== null,
      truncation_reason: reason,
      notes: ui.notes.value,
      audio_settings_requested: REQUESTED_AUDIO,
      audio_settings_applied: state.appliedSettings,
      user_agent: navigator.userAgent,
      gps_samples: src.gpsSamples,
      observed_fix_hz: core.observedFixHz(src.gpsSamples)
    });
    if (src.gpsSamples.length === 0) {
      ui.warning.textContent = WARNINGS.noGps;
    }
    downloadBlob(new Blob([wav], { type: "audio/wav" }), wavName);
    downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), label + ".json");
  }

  function streamLost(reason) {
    if (state.name === "recording" && transition("stream_lost")) {
      finalizeAndExport(reason);
    }
  }

  function stopStreams() {
    if (state.workletNode) { state.workletNode.disconnect(); state.workletNode = null; }
    if (state.audioContext) { state.audioContext.close(); state.audioContext = null; }
    if (state.mediaStream) { state.mediaStream.getTracks().forEach((t) => t.stop()); state.mediaStream = null; }
    if (state.geoWatchId !== null) { navigator.geolocation.clearWatch(state.geoWatchId); state.geoWatchId = null; }
    releaseWakeLock();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), CONFIG.objectUrlRevokeMs);
  }

  function hhmmss(date) {
    const p = (n) => String(n).padStart(2, "0");
    return p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
  }

  function showError(err) { ui.status.textContent = "Error: " + err.message; }

  function render() {
    ui.status.textContent = "State: " + state.name;
    ui.start.disabled = state.name === "recording" || state.name === "requesting_permissions";
    ui.stop.disabled = state.name !== "recording";
  }

  window.SensoryNavCapture = { init, streamLost };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
