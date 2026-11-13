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

- **Pixels:** `tools/golden-compare.sh <commit>` renders 10 scenarios (28 frames) from that commit and from the working tree with a seeded `Math.random`, a fake clock and scripted frames, and compares the exact pixels of the game canvas and the minimap. The harness itself was checked three ways: two captures of the same code are identical, a subtle gradient change is detected in all 28 canvas images, and a one-pixel minimap marker change is detected in all 21 minimap images. M0.6 (the renderer split) result: **all 56 images identical**.
- **Speed:** alternating before/after runs of `npm run perf:cpu` (about 1% noise); M0.6 result: 7.43 to 7.58 ms after against 7.46 to 7.52 ms before.
