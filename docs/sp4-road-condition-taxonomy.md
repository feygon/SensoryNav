# Road-Condition Taxonomy by Signal Signature (reference for SP4 + SP1 feature extension)

> **Status:** reference / not yet a spec. Captured 2026-06-28 during SP3 brainstorming. Feeds the future **SP4 qualitative classifier** and its prerequisite **SP1 phase-2 feature extension**. SP3 (the scalar roughness validator) deliberately does **not** use any of this — it scores *presence* + *spike magnitude* only. See `memory/project-sp3-research-scorer.md`.

## The unifying lever: speed converts *time* periodicity into *spatial* wavelength

A surface feature with spatial period **λ** (meters between bumps) produces a vibration/audio rhythm at frequency **f = speed / λ**. So a detected periodicity peak at `f` Hz, divided by SP2's `speed_mps`, recovers **1/λ** — a **speed-invariant fingerprint** of the surface. This is the single most important idea for distinguishing the *periodic* categories, and it is exactly why SP2's per-window speed (and heading) matter to classification, not just to the baseline.

- **Concrete slab rhythm** → λ ≈ 3.5–5 m (slab joints) → low spatial frequency; a slow *thump-thump* that speeds up with acceleration.
- **Washboarding** → λ ≈ 5–15 cm → high spatial frequency; a *buzz/drone* whose pitch tracks speed.
- Same speed, very different `f` ⇒ the `f/speed` ratio cleanly separates them.

## Grouping the taxonomy by signal signature

| Condition | Signal signature | Discriminating feature | Reachable from SP1 today (3 band energies + RMS + clip)? |
|---|---|---|---|
| Smooth new asphalt | at/below the floor | roughness residual ≈ 0 — this *is* the baseline | **Yes** |
| Pothole | impulsive transient, broadband, ~1 window | crest factor / short-time peak | Partial — need sub-window transient stat |
| Speed bump | impulsive transient **+ speed dip** | transient co-located with SP2 deceleration | Partial — transient + SP2 speed |
| Washboarding | periodic, high spatial-freq | periodicity peak, `f/speed` large | **No** — needs periodicity/modulation spectrum |
| Concrete slabs | periodic, low spatial-freq | periodicity peak, `f/speed` small | **No** — needs periodicity/modulation spectrum |
| Gravel / cinder | broadband **stochastic** hiss, no periodicity | high-band energy + spectral flatness, no autocorr peak | Partial — high band yes, flatness no |
| Ruts | sustained low-freq, steering-coupled | low-band elevation; honestly wants IMU/steering | Weak — ambiguous from audio alone |
| Standing water / hydroplaning | broadband whoosh, sudden onset; **paradoxically can reduce** tire-road contact noise | onset + the dangerous-but-quiet edge case | Weak |

## The feature gap (what SP1 phase-2 must add before SP4 can classify)

The current SP1 output (three band energies + RMS + clip fraction per 1 s window) supports a roughness **magnitude** and a crude spectral **tilt** (low-vs-high) — enough to separate *smooth / broadband-rough / high-frequency-rough*. It cannot:

- detect **periodicity** (washboard vs. slabs vs. gravel all read as "elevated high band") → needs an **autocorrelation / modulation-spectrum or cepstral** feature computed *within* the window, plus the **dominant modulation frequency**;
- detect **impulsiveness** (pothole vs. sustained rough) → needs a **crest-factor / sub-window peak** statistic;
- measure **spectral flatness** (gravel's stochastic hiss vs. a tonal washboard drone).

These are a small, well-bounded addition to SP1's per-window feature set, best designed and tuned against the real captures (`memory/project-real-trip-captures.md`) — washboard and slab periodicity especially cannot be faked convincingly in a synthetic fixture.

## Conditional-firing architecture (why classification is the last, gated step)

The qualitative SP4 classifier is **gated by prior aggregated detection**, not run everywhere:

1. **SP3** produces validated per-window detection + spike-magnitude (and, once aggregation exists, position+direction-keyed records).
2. Those pool across passes/users into a per-location, per-direction prior.
3. The in-situ device uses the prior to *predict* an upcoming event — establishing a **before** (approach signature), a recurring **pattern**, and a **predicted after**.
4. **Only once before + pattern → predicted-after is establishable** does SP4 classification fire — the expensive last step, run only where history says "something's coming."
