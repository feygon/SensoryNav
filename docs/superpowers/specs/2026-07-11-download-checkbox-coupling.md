# Quick spec — couple "Also download files" to "Analyze upon stopping" (2026-07-11)

**Status: IMPLEMENTED (2026-07-12) — `capture.html` `#also-download` ships `checked`; `capture.js`
`syncDownloadCoupling()` wired into `init()` + `#analyze-on-stop` `change`. Requirements Rubric: 41/45
READY (should-fix a11y affordance folded in below).**

**TL;DR:** On the capture page, "Also download files" should be forced on when the user isn't
analyzing, and default-on (but editable) when they are — so a capture is never silently lost. When
**"Analyze upon stopping" is or becomes UNCHECKED**, auto-**check** "Also download files" **and disable**
it (it's the only way the capture is saved, so it's mandatory). When **"Analyze upon stopping" is
CHECKED**, **enable** "Also download files" and **leave it checked until the user changes it**.

## Behavior

Two checkboxes in `capture.html` (`#analyze-on-stop` default checked; `#also-download`), wired in
`capture.js` (`ui.analyzeOnStop`, `ui.alsoDownload`).

| `analyze-on-stop` | `also-download` state |
|---|---|
| **unchecked** (or becomes unchecked) | `checked = true`, `disabled = true` — mandatory (a non-analyzed capture must be downloaded or it's lost) |
| **checked** (or becomes checked) | `disabled = false`, `checked = true` — default on, user may then uncheck it (→ analyze-only, no download) |

- "is **or becomes**" ⇒ apply the rule **on page load** (from the initial `analyze-on-stop` state) AND on
  every change of `analyze-on-stop`. Add a `change` listener on `#analyze-on-stop` plus a one-time call in
  `init()`.
- "leave it checked **until manually changed**" ⇒ when `analyze-on-stop` flips back to checked, set
  `also-download` checked and enabled; do **not** keep re-forcing it on later `also-download` changes —
  the user's manual uncheck (while analyze is on) must stick.

## Note on the existing default

This **changes `also-download`'s effective default to checked**. Today `capture.html:47` ships
`#also-download` unchecked; the coupling makes it checked whenever `analyze-on-stop` is checked (and
forced-checked when it's unchecked). **Resolution (both, so there's no flash regardless of the initial
`analyze-on-stop` state):** ship `#also-download` as `checked` in `capture.html` AND let the `init()`
coupling call reconcile disabled/checked on load. The pass-N / restart flow in `finalizeAndExport`
already reads `ui.alsoDownload.checked` live, so no logic there changes — only the checkbox's
checked/disabled state is coupled.

## Accessibility affordance for the forced state

When `also-download` is `disabled = true` (analyze off), a greyed, unchangeable checkbox with no
explanation is an a11y gap (screen-reader users and the sensory-sensitive owner get no reason for the
lock). **Set an explanatory `title` on the checkbox only while it is disabled**, and clear it when
enabled: `"Required — a non-analyzed capture must be downloaded or it's lost."` The coupling function
that flips `disabled` owns this `title` (set on disable, remove on enable) so the hint and the lock
state can never disagree.

## Round-trip note (do not add "memory")

A manual uncheck of `also-download` (while analyze is on) → unchecking analyze (forces checked+disabled)
→ re-checking analyze **resets `also-download` to checked**, discarding the earlier manual uncheck. This
is the intended behavior and is consistent with the table and acceptance #3 — do **not** add logic that
remembers and restores the pre-force manual state.

## Acceptance
1. Load with analyze checked → also-download enabled + checked, no `title`.
2. Uncheck analyze → also-download becomes checked + disabled (greyed) + explanatory `title` present.
3. Re-check analyze → also-download enabled + checked + `title` removed.
4. With analyze checked, manually uncheck also-download → it stays unchecked (analyze-only, no download)
   until analyze is toggled.
5. No console errors; capture/analyze/download flows otherwise unchanged.

---

## Related pending work (after compact) — analyze + aggregate the freeway passes
The user uploaded **8 new freeway passes** to `data/` (raw WAV + JSON sidecars): `1-130136`,
`7-122053`, `8-124205`, `Long-163826`, `P3-154945`, `P4-161124`, `Pass2-133324`, `Pass5-132245`
(16 WAVs / ~953 MB in `data/` total, incl. the older johnson-creek set). Next task: **score them and
aggregate their geo-data** (the cross-pass rough-spot aggregation — see `scripts/aggregate-rough.js`,
`scripts/aggregate-squelch.js`, `scripts/plot-roughmap.js`). This is a separate task from the checkbox
spec above; noted here so it survives the compact.
