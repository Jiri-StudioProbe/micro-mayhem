# M0 baseline (before the module split)

Recorded at the end of M0.1, on the single-file build. Every later M0 step must reproduce these; a difference is a regression unless it was intended and explained. Re-run with the commands shown.

## Behaviour that must not change

- **Veteran defaults** (the `?lab` panel output, asserted exactly by `tests/browser/lab.test.js`):
  `{"level":"veteran","gain":2.6,"curve":2.55,"maxLock":1,"speedDamp":0.45,"rate":79,"dead":0.14,"radius":48,"assistLane":0.3,"assistSpeed":1.1,"assist":"off"}`
- **Rookie defaults:**
  `{"level":"rookie","gain":2.6,"curve":2.55,"maxLock":1,"speedDamp":0.45,"rate":79,"dead":0.14,"radius":48,"assistLane":1.5,"assistSpeed":1.5,"assist":"on"}`
- **Stick steering** on a phone, Veteran, thumb moved 3 / 10 / 20 / 30 / 44 px from where it landed: about `0 / 0 / 0.09 / 0.45 / 0.69` (the larger values depend a little on car speed; the test asserts ranges, not exact values).
- **Track:** 429 units minimum separation between distant parts of the track (required: 216).

## Measurements

| What | Baseline | Command |
|---|---|---|
| Main-thread JavaScript per frame, full 6-car race, phone viewport | **2.2 to 3.0 ms** at 60 fps (3.0 ms in the first session, 2.2 to 2.4 ms for the identical code a day later; DPR 1 and 2 are the same: it is JavaScript only) | `npm run perf`, and for any comparison `tools/perf-compare.sh <commit>` |
| CPU per frame in virtual time (`npm run perf:cpu`), full 6-car race, phone viewport | **about 7.4 ms** (7.40 to 7.55 over six alternating runs of the same code before and after M0.5; about 1% noise) | `npm run perf:cpu` |
| Driver study, thumb-style driver, no assist | 0/12 wins, average place 4.3, 8.3 wall hits | `npm run study` |
| Driver study, thumb-style driver, Rookie assist | 11/12 wins, average place 1.4, 0.1 wall hits | `npm run study` |
| Driver study, keyboard-style driver | 7/12 wins, average place 2.8, 1 wall hit | `npm run study` |
| Whole test suite | 166 tests, about 2 min (CI: about 2 min of tests, 2.5 to 3 min with setup) | `npm test` |

**Never judge a refactor against a number written down in an earlier session**; run `tools/perf-compare.sh <commit>`, which measures the earlier commit and the working tree back to back. Expect about 10% noise in the performance numbers and some variation in the driver study (the sim is not seeded until M1). The statistical sim tests use 40 races per driver, chosen by bootstrapping 150 measured races so a false failure is about 0.03% per run.

## What the tests cover

- `tests/sim/` (headless, about 6 s): no-NaN soak of autopilot, random-input and attract-mode races, large time steps, track closure and separation, lab-mode rules, the measured effect of the assist.
- `tests/browser/` (real Chromium over a local web server, about 1.5 min): start screen, keyboard race, all three end-of-race screens and Race again, assist and sound toggles, phone touch controls (stick curve, always-on gas, base following, BRAKE and FIRE, two fingers), the whole Steering Lab, the profile scenarios (stale, corrupt, hostile and version-mismatched saves, per-level overrides, `?level=`), a 9,000-frame soak on the real loop, and a regression test for the far-away-explosion freeze.
- Checked by deliberately breaking the game: re-introducing the freeze bug, changing a baked-in default, leaking an old setting, and removing the lab's no-damage rule each fail the suite.

## Debug hook

`window.__mm` (`S`, `input`, `Sim`, `tune`, `level`) exists only when the page is opened with `?debug`. Tests use it to read state without depending on how the code is organised; keep it working through the module split.

## Proving that a refactor changed nothing

Use these two together; neither depends on a number written down in an earlier session.

- **Pixels and interface state:** `tools/golden-compare.sh <commit>` renders 19 scenarios (81 frames) from that commit and from the working tree with a seeded `Math.random`, a fake clock and scripted frames, and compares the exact pixels of the game canvas and the minimap, and a hash of the state of the HUD, overlays, buttons, sliders and input values (`dom`; its JSON is saved next to the images, so a difference can be read). The harness itself was checked three ways: two captures of the same code are identical, a subtle gradient change is detected in all 28 canvas images, and a one-pixel minimap marker change is detected in all 21 minimap images. M0.6 (the renderer split) result: **all 56 images identical**. The harness was extended for M0.7 with the interface scenarios (settings buttons and mute, keyboard, touch stick with FIRE and BRAKE, the lab panel with level switch, reset and lap timing, the three results screens, starting while the damage flash shows); the extension is deterministic (two captures of the same code are identical) and was checked by mutation: breaking the results labels, the assist button, the lab panel's level hook, the camera easing, the HUD's screen reset and the flash reset at race start were each detected. M0.7 result: **all 243 recorded states identical** against M0.6.
- **Speed:** alternating before/after runs of `npm run perf:cpu` (about 1% noise); M0.6 result: 7.43 to 7.58 ms after against 7.46 to 7.52 ms before. M0.7 result (two alternating pairs, same session): 7.09 and 7.06 ms after against 7.11 and 7.15 ms before.

## M1: the baseline moves

M1.1 replaced `Math.random` in the sim with seeded streams, so the golden images and the driver-study numbers are no longer comparable with M0 pixel for pixel: the races are different races. What was checked instead:

- **Same distributions.** The driver study over 5 independent batches of 400 races per row, before (unseeded) and after (seeded). Wins per 400: keyboard 227 to 253 before and 229 to 252 after; thumb + Rookie assist 339 to 353 before and 336 to 352 after; keyboard + Rookie assist 347 to 357 before and 329 to 354 after; thumb with no assist or with Veteran assist: 0 to 2 both times. Average places and wall hits agree to within 0.1.
- **Repeatability.** The same study run twice prints identical output.
- **Reference for M1.2.** From M1.1 on, `tools/golden-compare.sh <commit>` is again meaningful for refactors; M1.2 (fixed step) changes timing on purpose, so it is judged by the driver study and `perf:cpu`, not by pixels.

### M1.2: the fixed step

The simulation code did not change (`Sim.STEP` is the only addition), so the driver study printed **exactly** the M1.1 numbers (diffed, 400 races per row), and `perf:cpu` is unchanged (5.80 ms against 5.80 and 5.90 for M1.1, alternating). What did change is how the shell feeds it, and that is tested directly: unit tests for the stepper (60, 120, 144, 240 and 30 Hz, jittery frames, long pauses, a step that throws), the interpolator (angles across the seam, new and removed objects, exact restore) and the loop (call order, exact `STEP` per step, restore after a failing draw); and browser tests that game time keeps pace with the clock at 30, 60, 120, 144 and 240 Hz and with uneven frames, that the picture changes on every frame at 144 Hz, and that the simulation state is never left interpolated. Mutation checks of the three modules: 15 of 17 broken versions were caught, and the other 2 are equivalent (the result is the same).

Golden images are not comparable with M1.1 (the picture is a fraction of a step behind, and 16.7 ms virtual frames now meet a 16.667 ms step); against M1.1, the HUD, overlay and button state differs only in the 0.1% steering-smoothing difference and in one countdown digit that sits exactly on a rounding boundary. The harness is deterministic (two captures identical), so M1.3 can use it again.

### M1.3: the race config and the rules version

Judged the way M0 refactors were: against M1.2, the golden harness is **identical in all 243 states** and the driver study prints **exactly the same numbers** (diffed, 400 races per row). Beyond that, the four races that pin `SIM_VERSION` 1 (`tests/sim/simversion.test.js`) were computed on the M1.2 code through its old API and gave the same four hashes as the new code through the config API, which proves M1.3 did not change the rules. Mutation checks: 9 deliberate rule changes (acceleration, top speed, grip, a track point, crate odds, AI skill, wall damage, the number of random draws, the assist formula) were each caught by the fingerprint; 12 config-handling mistakes and 6 shell-wiring mistakes were each caught by a test.

### M2.1: race records

Behaviour a player can see did not change, and that is checked: the golden harness is **identical to M1.3 in all 243 states**, the driver study prints exactly the M1.3 numbers, and the pinned rules fingerprint (`SIM_VERSION` 1) still holds with the lap and assist bookkeeping added to the sim. `perf:cpu`: 5.59 to 5.87 ms against 5.60 to 5.79 ms for M1.3 in alternating pairs (differences of +0.6% to +1.4% in the later pairs; one early pair was +4.6%, which this measure's noise reaches). A saved race is about 385 bytes, so the full 500-race history is about 190 KB of the roughly 5 MB localStorage allows.

Measured for the tests' bounds, over 300 autopilot races: a finished race always had exactly 3 laps of 24.5 to 29.5 s, and the time before the first crossing of the line was 0.88 to 0.93 s; races that ended early had 0 to 2 laps. Mutation checks: 35 deliberate breakages of the validation, bests, recorder, profile migration and sim bookkeeping, and 5 of the shell wiring, were each caught.

### M2.2: records on the results screen

Against M2.1, every canvas and minimap image is identical in all 243 states, and of everything else recorded for each frame (screen state, buttons, input) the only difference, in all 81 frames, is the text of the results card, which now contains the records block (checked key by key from the saved state files, not just from the hash). The driver study is untouched. The golden harness gained the records elements and a scenario for them (20 scenarios, 87 frames, 261 states), and is deterministic.

A layout regression was caught while checking screenshots and fixed before release: the records block made the results card 506 px tall, so on a 390 px landscape phone the "Race again" button fell below the fold (before, the card was 312 px). On short landscape screens the card is now two columns; ten screen sizes are tested to fit, from 320x568 to 1366x600. Also fixed: `fmtTime` showed 59.97 s as `0:60.0`. Mutation checks: 19 breakages of the wording logic, the wiring and the CSS were caught; two first survived (CSS rules that a test never noticed because it checked the `hidden` property, not whether the element was really visible), and the tests were changed until they were caught too.
