# Design — Capture restart fix + Pass-N filenames (2026-07-10)

**TL;DR:** Two fixes to the capture page found in real phone use. (1) **Restart bug:** after Stop you
can't start another recording without a page refresh — the state machine parks in `stopped` and never
returns to `idle`. Fix: return to `idle` after export. (2) **Filename default:** it defaults to
`johnson-creek-pass-1`, which only makes sense for that one road. Make the default **`Pass-N`**, where N is
the lowest number not yet used by this app; after a file downloads, advance N to the next lowest unused —
unless the user renamed it. The numbering logic is a small **pure unit** (`recorder/pass-namer.js`) with a
frontmatter block; the persistence/DOM/download side-effects stay in `capture.js` (imperative shell).

## 1. Restart bug

`recorder/capture-state.js` transitions: `recording --stop--> stopped`, and `stopped` only accepts
`reset --> idle`. After `onStop`, nothing fires `reset`, so state stays `stopped`. `render()` leaves Start
visually enabled, but `onStart`'s `transition("start")` is invalid from `stopped` (only valid from `idle`),
so Start silently no-ops. Only a refresh (which re-inits to `idle`) recovers.

**Fix:** after `finalizeAndExport` finishes a NON-navigating path, fire `transition("reset")` to return to
`idle`. The three non-navigating exits that must reset:
- the download-only path (`analyze-on-stop` off) after both `downloadBlob` calls;
- the trim-too-short bail (`trimCapture` returned null — today it `return`s and is ALSO stuck);
- the analyze-handoff `.catch` fallback that downloads instead.
The analyze-handoff success path navigates to `analyze.html` (page changes), so it needs no reset.
A fresh start after reset re-acquires the mic/stream and a new `AudioContext`/worklet — verified the
existing `requestStreams`/`startRecording` fully re-initialize per-recording state.

## 2. Pass-N filenames

**Constraint (stated up front): a web page cannot read the Downloads folder.** Mobile Chrome (the capture
target) doesn't support directory enumeration, and the current flow is a plain anchor-download. So "lowest
numeral not occupied by an existing file" must mean **lowest not occupied by a file THIS APP has
downloaded** — tracked in `localStorage` and persisted across refreshes. This is the only approach that
works on a phone; true filesystem awareness would need the File System Access API + a user-granted
directory, which mobile Chrome lacks. Documented limitation.

**Behavior:**
- The editable label field defaults to `Pass-N`, N = lowest positive integer not in the persisted
  `used` set (empty set → `Pass-1`).
- The downloaded filename is the label value directly: `Pass-N.wav` / `Pass-N.json` — the **`-HHMMSS`
  timestamp suffix is dropped** for this default, because the numeral is now the identity and the user
  asked for the name to be `Pass-#`. (A user who types a custom label still gets exactly that label.)
- When a file named `Pass-N` downloads, add N to `used` (persist), then set the field to `Pass-`+the new
  lowest unused, ready for the next recording.
- **"provided it's not renamed in the meantime":** a custom (non-`Pass-N`) label is never added to `used`,
  so its would-be number stays available and is offered again — faithful to "lowest not occupied." The
  auto-advance only consumes a numeral that was actually downloaded under the `Pass-N` name.
- Only DOWNLOADS consume a numeral. `analyze-on-stop` without `also-download` navigates away without
  downloading, so it consumes nothing (consistent — no file was written).

**Collision behavior (explicit).** Two cases:
- *Self-collision* (a number the app already produced): prevented by the persisted `used` set — never
  re-offered. This is the common repeated-recording case and is fully handled.
- *Unknown disk collision* (a `Pass-N` file already on disk that this app did NOT download — cleared
  storage, other device/browser, manual file): **the page cannot detect it.** `<a download>` is
  fire-and-forget: no callback, no access to the saved filename. The browser silently de-duplicates
  (Chrome writes `Pass-N (1).wav`), so **nothing is ever overwritten**, but the app can't see or react to
  the rename, so it cannot "increment in response." The `used` set still advances (it recorded N as
  downloaded), so subsequent numbers stay collision-free from the app's side.
- *Truly* collision-aware naming would require the **File System Access API** (grant a directory once, then
  the page can test `Pass-N` existence and pick the next free name). That API is **desktop-Chromium only —
  mobile Chrome and Safari don't support it**, and the capture target is a phone. So it is explicitly NOT
  the primary path; it could be an optional desktop-only enhancement later. Not in scope here.

## 3. New unit + frontmatter

`recorder/pass-namer.js` — a **pure** module (dual export to `window.SensoryNavCore`, matching the other
recorder classic-script modules), carrying an `@unit-begin` frontmatter block per
`docs/scorer-frontmatter-standard.md`:
```
contract: passName(n) -> "Pass-<n>" · parsePassNumber(name) -> number|null · nextUnused(used[]) -> number>=1
causality: pure   state: none   mutates: none   realtime: reuse-as-is   tested-by: tests/pass-namer.test.js
```
Note: `scripts/generate-scorer-registry.js` scans `harness/**` only, so this `recorder/` block is
documentation (not registry-enforced) unless the generator's scan is later widened. The side-effects
(`localStorage` read/write, setting the input value, triggering downloads) live in `capture.js` — the unit
is pure and testable in isolation.

## 4. Acceptance
1. Record → Stop → Record again with NO page refresh (state returns to `idle`; Start works).
2. Trim-too-short bail also returns to `idle` (not stuck).
3. Default label is `Pass-N` with N = lowest unused; empty history → `Pass-1`.
4. After a `Pass-N` file downloads, the field advances to the next lowest unused; a custom-renamed download
   does not consume a numeral.
5. `used` persists across a page refresh.
6. `tests/pass-namer.test.js` (pure unit) green; full `npm test` green.
