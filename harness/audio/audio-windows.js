"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const { bandEnergiesFromSpectrum, averageWindowEnergies } = require("../../recorder/audio-scoring");
const { realFftDb } = require("./fft");

const FFT_SIZE = CONSTANTS.FFT_SIZE;                 // 2048
const HOP = FFT_SIZE / 2;                            // 1024
const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS; // 1000
const ENERGY_FLOOR_MIN = CONSTANTS.ENERGY_FLOOR_MIN;     // 1e-6
const CLIP_THRESHOLD = 0.999; // just below the ±1.0 decode ceiling so full-scale samples count as clipped
const NEAR_FLOOR_K = 10;
const PARTIAL_MIN_COVERAGE_S = 0.5;

function windowIndexFor(frameCenterSample, samplesPerWindow) {
  return Math.floor(frameCenterSample / samplesPerWindow);
}

// STFT: per full frame, the band energies and the frame's center sample.
function stft(samples, sampleRate) {
  const frames = [];
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
    const frame = samples.subarray(start, start + FFT_SIZE);
    const energies = bandEnergiesFromSpectrum(realFftDb(frame), sampleRate, FFT_SIZE);
    frames.push({ centerSample: start + FFT_SIZE / 2, energies });
  }
  return frames;
}

// Group per-frame band energies by their window index.
function assignFramesToWindows(frames, samplesPerWindow) {
  const byWindow = new Map();
  for (const f of frames) {
    const wi = windowIndexFor(f.centerSample, samplesPerWindow);
    if (!byWindow.has(wi)) byWindow.set(wi, []);
    byWindow.get(wi).push(f.energies);
  }
  return byWindow;
}

// Single time-domain pass over a window's raw samples.
function windowRmsAndClip(samples, startSample, endSample) {
  let sumSq = 0;
  let clipped = 0;
  for (let i = startSample; i < endSample; i++) {
    const s = samples[i];
    sumSq += s * s;
    if (Math.abs(s) >= CLIP_THRESHOLD) clipped++;
  }
  const n = endSample - startSample;
  return {
    rms: n > 0 ? Math.sqrt(sumSq / n) : 0,
    clip_fraction: n > 0 ? clipped / n : 0,
    sampleCount: n
  };
}

function framesToWindows(samples, sampleRate, audioFirstFrameMs) {
  if (samples.length < FFT_SIZE) return [];
  const samplesPerWindow = Math.round((sampleRate * WINDOW_DURATION_MS) / 1000);
  const byWindow = assignFramesToWindows(stft(samples, sampleRate), samplesPerWindow);

  const fullWindows = Math.floor(samples.length / samplesPerWindow);
  const remainder = samples.length - fullWindows * samplesPerWindow;
  const keepPartial = remainder >= PARTIAL_MIN_COVERAGE_S * sampleRate;
  const lastWindowIndex = keepPartial ? fullWindows : fullWindows - 1;

  const windows = [];
  for (let i = 0; i <= lastWindowIndex; i++) {
    const startSample = i * samplesPerWindow;
    const endSample = Math.min((i + 1) * samplesPerWindow, samples.length);
    const energiesList = byWindow.get(i) || [];
    const avg = averageWindowEnergies(energiesList);
    const stats = windowRmsAndClip(samples, startSample, endSample);
    const isPartial = stats.sampleCount < samplesPerWindow;
    windows.push({
      window_id: "w" + i,
      started_at_ms: audioFirstFrameMs + i * WINDOW_DURATION_MS,
      duration_ms: isPartial ? Math.round((stats.sampleCount / sampleRate) * 1000) : WINDOW_DURATION_MS,
      frame_count: energiesList.length,
      low_energy: avg.low,
      mid_energy: avg.mid,
      high_energy: avg.high,
      rms: stats.rms,
      clip_fraction: stats.clip_fraction,
      near_floor: Math.max(avg.low, avg.mid, avg.high) < NEAR_FLOOR_K * ENERGY_FLOOR_MIN
    });
  }
  return windows;
}

module.exports = { framesToWindows, windowIndexFor };
