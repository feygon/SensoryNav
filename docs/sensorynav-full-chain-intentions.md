# SensoryNav — Full-Chain Intentions

Status: **vision / direction** · First written 2026-07-05

This records where SensoryNav is headed, so any single spec can be understood as one link in a
chain rather than the whole product. It is intent, not a commitment to build all of it now.

## What the finished product does

A rider who is sensory-sensitive uses a nav map that accounts for how a road *feels*, not just how
fast it is:

- **Route chooser** — before driving, picks the calmer of two routes (needs a positional sensory
  map of road segments).
- **Real-time forecast / warning** — while driving, signals harsh stretches ahead.

If SensoryNav is a full nav map it does both; if it is only a data layer/overlay read by another
nav program, it does the real-time forecast. Either path needs **collaborators and investors** —
the aggregate map requires **thousands of users** (witting or unwitting) contributing at
**zero friction**, no meaningful data or battery cost, and it must re-map faster than construction
crews and asphalt degradation change the roads (a roughly yearly clock).

## Adoption strategy

Innovators first (Rogers' first ~2.5%). The current offline research scorer will not survive past
prototype, but it is how we produce the visualizations that fire an innovator's imagination. **The
first hi-fi prototype is "done" when it is a viable tool for attracting innovators to collaborate
and integrate.** At that stage zero-friction is a goal, not yet a requirement — the innovators are
the heavy lifters and are too few to supply full aggregate data anyway.

## The chain, in build order

```
   audio + GPS
        │
   [1] metric / tag-extraction   ← current spec (spectral-chaos + tags)
        │   emits scientifically-grounded tags (value + confidence) per event
        ▼
   [2] aggregator                ← BUILT NEXT (before the classifier)
        │   weights tag assertions across many trips; resolves a per-trip guess
        │   into a confident answer; a self-informing heuristic that learns what
        │   to look for next time
        ▼
   [3] classifier                ← built AFTER the aggregator, on purpose
        │   tags → event label + confidence ("manhole 74%")
        ▼
   [4] per-trip dashboard        ← the pitch artifact: FFT + band lines, tagged
        │   events with tooltips, glimpse of aggregation, accelerometer-gap prompts
        ▼
   [5] accelerometer app         ← event-triggered capture only (privacy)
        ▼
   nav integration (route chooser + real-time warning)
```

**Why aggregator before classifier:** aggregation is the real engine — its ability to weight many
inputs and iteratively inform itself is where the value lives. Building it first gives us the
object-lesson of how far per-trip classification is from the classification that is actually
possible in the limited, pre-innovator scope. The classifier is then designed against a measured
gap rather than a guess. Per-trip classification is a **hook** to motivate uploads; the aggregator
is the product.

## Privacy architecture (intent)

- **No audio stored** — audio is analyzed locally (client-side) and discarded; only derived
  features/tags leave the device.
- **De-identified telemetry** — uploaded JSON carries no identifying data.
- **Vocal ranges de-emphasized or deleted** — speech lives in mid/high; if the road telemetry does
  not need those bands (sub-bass/low carry the road signal), drop them outright when talking is
  detected.
- **Accelerometer is event-triggered** — it listens only when prompted by an audio event, never a
  continuous recording of gait or vehicle signature.

## The accelerometer's role

Audio cannot always resolve *what* an event was (a manhole and a pothole can sound alike). The
vertical-impact signature disambiguates. The tag registry records, per tag, whether an
accelerometer `disambiguates` or is `required` — so the dashboard can show the innovator exactly
the seam their sensor work would fill.

## Provenance

The felt-roughness signal ("spiky squiggles") is a multi-generational family trait; giving it a
name, a measure, and a use is part of the project owner's motivation and legacy. The offline
research visualizations are archived as legacy artifacts (see `data/legacy-visualizations/`) to
preserve the moments of research that shaped this direction.
