// harness/score/roughness-db.js
// Delta-dB roughness: how many decibels a window's band energy sits ABOVE that run's own
// speed-conditioned baseline floor.
//
// Architecture (deliberate): the baseline — the road/tire/car/condition noise expected at a
// given speed — is a PER-RUN quantity. It is fit once per run (per vehicle, per conditions)
// and supplied here as `floors`; it is NEVER aggregated across runs. The only quantity that
// is comparable and aggregable across runs is this DELTA over each run's own floor, because
// the floor already absorbs the run-specific and speed-specific baseline. Aggregate deltas,
// never baselines.
//
// The floor is speed-conditioned upstream (floors are looked up at the window's speed), so the
// delta is already speed-normalized — a bump reads the same magnitude slow or fast. Any future
// speed-dependent *sensory* weighting (a gentle jolt at 3 mph vs. a jarring one at 40) belongs
// on top of this measurement, not inside it.
"use strict";

const EPS_ENERGY = 1e-12;      // guards log10(0); ~ -120 dB
const BANDS = ["low", "mid", "high"];

// Linear power ratio -> decibels, with a floor so silence is a finite very-low dB.
function toDb(energy) {
  return 10 * Math.log10(Math.max(energy, EPS_ENERGY));
}

// Per-band excess over the floor, in dB, clamped at 0. At or below the floor the band is
// "at baseline" (smooth) and contributes nothing; roughness is never negative.
function bandDeltaDb(energy, floor) {
  return Math.max(0, toDb(energy) - toDb(floor));
}

// Weighted delta-dB roughness for one window. `energies` and `floors` are { low, mid, high }
// linear-power maps; `floors` come from THIS run's own baseline at THIS window's speed.
// `weights` are { low, mid, high }.
function roughnessDb(energies, floors, weights) {
  let sum = 0;
  for (const b of BANDS) {
    sum += weights[b] * bandDeltaDb(energies[b], floors[b]);
  }
  return sum;
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { toDb, bandDeltaDb, roughnessDb, EPS_ENERGY, BANDS };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
