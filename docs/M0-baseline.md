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
| Main-thread JavaScript per frame, full 6-car race, phone viewport | about **3.0 ms** at 60 fps (DPR 1 and 2 are the same: it is JavaScript only) | `npm run perf` |
| Driver study, thumb-style driver, no assist | 0/12 wins, average place 4.3, 8.3 wall hits | `npm run study` |
| Driver study, thumb-style driver, Rookie assist | 11/12 wins, average place 1.4, 0.1 wall hits | `npm run study` |
| Driver study, keyboard-style driver | 7/12 wins, average place 2.8, 1 wall hit | `npm run study` |
| Whole test suite | 40 tests, about 2 min (CI: 1 min 45 s of tests, 2.5 min with setup) | `npm test` |

Expect about 10% noise in the performance numbers and some variation in the driver study (the sim is not seeded until M1). The statistical sim tests use 40 races per driver, chosen by bootstrapping 150 measured races so a false failure is about 0.03% per run.

## What the tests cover

- `tests/sim/` (headless, about 6 s): no-NaN soak of autopilot, random-input and attract-mode races, large time steps, track closure and separation, lab-mode rules, the measured effect of the assist.
- `tests/browser/` (real Chromium over a local web server, about 1.5 min): start screen, keyboard race, all three end-of-race screens and Race again, assist and sound toggles, phone touch controls (stick curve, always-on gas, base following, BRAKE and FIRE, two fingers), the whole Steering Lab, the profile scenarios (stale, corrupt, hostile and version-mismatched saves, per-level overrides, `?level=`), a 9,000-frame soak on the real loop, and a regression test for the far-away-explosion freeze.
- Checked by deliberately breaking the game: re-introducing the freeze bug, changing a baked-in default, leaking an old setting, and removing the lab's no-damage rule each fail the suite.

## Debug hook

`window.__mm` (`S`, `input`, `Sim`, `tune`, `level`) exists only when the page is opened with `?debug`. Tests use it to read state without depending on how the code is organised; keep it working through the module split.
