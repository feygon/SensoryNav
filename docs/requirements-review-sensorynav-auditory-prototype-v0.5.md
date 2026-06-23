# Requirements Rubric Gate Report: SensoryNav Auditory Prototype PRD (v0.4 → v0.5)

## TLDR

The PRD passed the Requirements Rubric gate. An independent `requirements-reviewer` scored the spec **37/45 (NEEDS MINOR REVISIONS)** on first pass, all 2 critical + 5 should-fix gaps were resolved inline, and a re-review scored **45/45 (READY)** with no open should-fix items.

- **Score trajectory:** `37 → 45` (+8)
- **Final verdict:** READY for decomposition (pending human approval)
- **Gate:** Planner Requirements Rubric, run after Superpowers `brainstorming` and before `writing-plans`
- **Reviewed file:** `docs/specs/prd-sensorynav-auditory-prototype.md`

This gate is distinct from the earlier Codex self-review (`requirements-review-sensorynav-auditory-prototype.md`, 38→43), which scored its own output. This report is an independent pass.

## Contents

1. Context
2. Score Trajectory
3. Pass 1 — Dimension Scores (37/45)
4. Findings And How Each Was Closed
5. Pass 2 — Dimension Scores (45/45)
6. Non-Blocking Observations
7. Provenance

## Context

The PRD was originally authored outside the Superpowers process (by Codex), which skipped the disciplined intent → design → plan chain and self-reviewed its own spec. Covering that gap involved:

1. An independent technical-design pass (produced PRD v0.4), adding: mic AGC-off constraint, precise FFT band-energy definition, baseline epsilon floor, single epoch-ms clock base, CVD-safe color scale, a GPS-motion pause/resume lifecycle with a manual deactivate control, and a Deferred Goals section.
2. This Requirements Rubric gate (produced PRD v0.5), below.

## Score Trajectory

| Pass | PRD Version | Score | Verdict |
|---|---|---:|---|
| 1 (initial) | v0.4 | 37/45 | NEEDS MINOR REVISIONS |
| 2 (re-review) | v0.5 | 45/45 | READY |

The earlier Codex self-review's 43/45 was optimistic: it credited the *naming* of mechanisms as if they were *fully specified*, when several lacked the constants needed to write a deterministic test.

## Pass 1 — Dimension Scores (37/45)

| # | Dimension | Score | Justification |
|---|---|---:|---|
| 1 | Clarity & Precision | 4 | Band energy, AGC, and clock base precise, but motion thresholds and `energy_floor` value were undefined placeholders. |
| 2 | Completeness | 4 | Functional surface thorough; missing FFT parameters, state-transition ownership, failure/rollback for stream loss, function-size constraint. |
| 3 | Testability | 4 | Most ACs had verification clauses, but several referenced constants that did not exist, so tests could not be deterministic. |
| 4 | Consistency | 3 | Data Model used ISO-8601 strings while US-004/FR-005 mandated epoch-ms; `duration_seconds: 30` misleading under moving-only baseline. |
| 5 | Traceability | 5 | Stable IDs, priorities, deferrals linked to originating sections. |
| 6 | Feasibility | 5 | Build/buy split explicit, browser-API constraints acknowledged, assumptions stated. |
| 7 | User Experience | 5 | Glanceable targets, no-interaction-while-driving, screen-reader controls, light/dark, non-color redundant cue. |
| 8 | Security & Compliance | 4 | Strong local-only privacy model; permission-revocation-mid-trip and localStorage retention/clearing underspecified. |
| 9 | Maintainability | 3 | Good module separation and changelog, but no function-size constraint and no formula-version migration story. |

## Findings And How Each Was Closed

| Severity | Finding (section) | Resolution in v0.5 |
|---|---|---|
| 🔴 Critical | Undefined motion thresholds (US-002b, FR-013, US-007) | `Tunable Constants` block: `PAUSE_STOPPED_THRESHOLD_MPS`=0.5, `PAUSE_MOVING_THRESHOLD_MPS`=1.5 (hysteresis), `PAUSE_HOLD_SECONDS`=3, null-speed = never pause. US-002b cites them with matching verification. |
| 🔴 Critical | ISO-8601 vs epoch-ms contradiction (Data Model vs US-004/FR-005) | Data Model timestamp-convention note; pairing/ordering fields are `_ms` integers (`created_at_ms`, `started_at_ms`, `captured_at_ms`, `gps_captured_at_ms`); ISO demoted to derived display copy. Located sample now carries `gps_captured_at_ms` for the US-005 detail view. |
| 🟡 Should-fix | `energy_floor` had no value/derivation (Scoring Formula) | Defined as per-session measured band median guarded by hard `ENERGY_FLOOR_MIN`=1e-6 (linear power, matching US-003 sum); both recorded in session baseline (`energy_floor_min`, `effective_floor`). |
| 🟡 Should-fix | FFT parameters undefined (US-003, FR-003) | `FFT_SIZE`=2048, `SMOOTHING_TIME_CONSTANT`=0 (with rationale), actual-sample-rate handling + `ASSUMED_SAMPLE_RATE_HZ`=48000 fallback, lower-inclusive/upper-exclusive band edges, `WINDOW_DURATION_MS`=1000. |
| 🟡 Should-fix | State ownership + mid-trip failure modes (FR-001, FR-009) | Single `session-controller` owns a complete legal-transition table; FR-009 adds stream-loss and permission-revocation rows → `error`, preserving captured data and allowing partial export. |
| 🟡 Should-fix | No function-size constraint (Architecture) | ~100-line target / 300 hard limit; explicit decomposition of audio analysis, scoring, and pairing into separate functions. |
| 🟡 Should-fix | Pairing tie-break/asymmetry (US-004, FR-005) | `PAIR_MAX_SKEW_SECONDS`=5 (±5 s), GPS sample reusable across windows, earlier-timestamp tie-break. |
| ⚪ Minor | `duration_seconds` misleading; success metric subjective; FR-012 retention default | Renamed `moving_duration_seconds`; success metric gains a ≥30-point score-range proxy; FR-012 sets off-by-default persistence + non-fatal quota warning + always-available delete control. |

## Pass 2 — Dimension Scores (45/45)

| # | Dimension | Score | Justification |
|---|---|---:|---|
| 1 | Clarity & Precision | 5 | Constants centralized as single source of truth; band-energy and timestamp conventions precise. |
| 2 | Completeness | 5 | Full lifecycle, mid-trip failure modes, error states, data model, architecture, function-size constraint. |
| 3 | Testability | 4 | Every US/FR has a verification clause; minor: no explicit numeric tolerance on the synthetic-tone or trace-render assertions. |
| 4 | Consistency | 5 | Thresholds, `_ms` fields, pairing rules align across US, FR, Data Model, Tunable Constants. |
| 5 | Traceability | 5 | Stable IDs, priorities, cross-references, Deferred Goals linked. |
| 6 | Feasibility | 5 | Build/buy split, browser-target tiers, bounded-residual speed reasoning. |
| 7 | User Experience | 5 | Workflows, accessibility, in-car safety copy all addressed. |
| 8 | Security & Compliance | 5 | Local-only, no upload, raw audio not persisted, user-initiated export, clearable storage, visible consent. |
| 9 | Maintainability | 5 | Versioned schema + changelog, named-constant mandate, Open Questions and Deferred Goals preserve future intent. |

All eight prior items verified genuinely closed.

## Non-Blocking Observations

Below the should-fix bar; do not affect the READY verdict:

- **US-003 verification** lacks a numeric tolerance ("higher energy in the expected band"); a target ratio (e.g. expected band ≥ 10× neighbor) would prevent a brittle exact-equality test.
- **US-005 verification** lacks a concrete element/color assertion; the US-008 fixture (≥3 score tiers) makes it implementable, so it is cosmetic.
- **`accuracy_meters`** is captured but unused in v0 pairing; worth a one-line note that this is intentional (exported for later analysis).

## Provenance

- Gate: Planner skill Requirements Rubric (`~/.claude/skills/planner/SKILL.md`).
- Reviewer: `requirements-reviewer` agent, two independent passes (no file edits by the reviewer).
- Spec under review: `docs/specs/prd-sensorynav-auditory-prototype.md` (v0.5).
- Date: 2026-06-22.
- Next step in the Superpowers spine: `writing-plans` (code-level TDD implementation plan).
