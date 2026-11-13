# Micro Mayhem: project documentation

A top-down, slightly pseudo-3D toy-car combat racer. Six cars, three laps, a looping track with multiple turns, pickup weapons, damage and destruction. The page (`index.html`) holds the markup and the CSS; the code is ES modules in `src/` (the simulation in `src/sim/sim.js`, the game shell in `src/main.js`, and small modules around them). There is no build step and no image assets. The shell split is done (M0.5 to M0.7): `src/main.js` only builds the pieces and wires them together. The start screen shows the version and the deployed commit (M0.8, which finished milestone M0; see `docs/ROADMAP.md`).

This file is the project context for Claude Code. The game is deployed to GitHub Pages by `.github/workflows/pages.yml`: every push runs the tests, and a push to `main` that passes them is deployed and then verified against the live site (see section 9). **Planned features and the architecture they need are in `docs/ROADMAP.md`; read it before starting character creation, car selection, saved scores, aura/shop or new tracks.**

---

## 1. Run it

- Serve the folder and open it: `npm run serve` (or `python3 -m http.server`), then http://localhost:8000. Opening `index.html` straight from disk no longer works, because browsers refuse to load ES modules over `file://`.
- The game has no network dependencies: the fonts (Bungee for display, Barlow Condensed for UI) are hosted with the game in `fonts/` (SIL Open Font License, notices in `fonts/LICENSES.txt`), so it works fully offline and no third party sees a visitor. The files are Latin subsets; supporting other alphabets (for example in player names) means adding the `latin-ext` files from the `@fontsource` packages and a matching `@font-face` rule. Tests block every non-local request, so a stray third-party link fails the suite.
- Desktop: arrow keys or WASD to steer and accelerate, Space or F or Shift to fire, `M` to mute, Enter or Space to start from a menu.
- Touch: an on-screen control scheme appears on the first touch. Left thumb: floating drive joystick. Left thumb down = gas always on; x steers (analog; response is `sign(x) * min(maxLock, gain * |x|^curve)` then eased by `rate`, all in `TUNE_DEFS`, see section 5c). The base appears where the thumb lands and trails it when it leaves the stick radius. Right thumb: FIRE button, plus a small BRAKE/REVERSE button beside it. **Difficulty level** (Rookie or Veteran, chosen on the start screen or in the lab panel) sets whether the **driving assist** (section 5b) starts on and every steering default; see section 5c. The assist can still be toggled from the start screen, the HUD or the lab panel.

## 2. What exists

| Area | State |
|---|---|
| Camera | Tilted top-down with perspective, rotates to follow the car's heading |
| Track | One closed spline circuit, about 8,000 units long, 7 turn-direction changes, tightest radius about 100 units |
| Cars | 1 player + 5 AI, 100 hull each, simple arcade physics |
| Weapons | Machine gun, homing rockets, mines, plus a repair pickup |
| Damage | Bullets, explosions, car-to-car collisions, wall hits |
| Destruction | Cars explode, leave a burning wreck for 7 s that blocks others |
| Win conditions | First across the line after 3 laps, or last car alive |
| Lose condition | Your hull hits 0 |
| UI | Start screen, HUD (position, lap, hull bar, weapon and ammo, minimap), toasts, countdown, results screen |
| Audio | Synthesised with WebAudio (engine, shots, explosions, pickups, countdown) |
| Attract mode | The start screen runs an AI-only race in the background |

## 3. File structure

The game is an ES module graph. `index.html` loads `src/main.js`, which imports the rest:

| Module | What it is | Notes |
|---|---|---|
| `src/sim/sim.js` | The simulation (`import { Sim } from './sim/sim.js'`, also the default export) | **Pure**: no DOM, canvas, audio, storage, timers, network or `console`. Enforced by lint (`eslint.config.js` gives `src/sim/` no host globals, bans importing the shell, bans `Date`/`globalThis`). Moved out of the page byte for byte in M0.4 |
| `src/main.js` | The shell: builds every piece below and wires them together (about 80 lines, no logic). Also the `?level=`, `?lab` and `?debug` handling and the `window.__mm` hook | Moved out of the page byte for byte in M0.5a, then split into the modules below in M0.5 to M0.7 |
| `src/input.js` | `createInput({ S, tune, initAudio })` returns `{ readInput, stickRelease, connect }`: keyboard, BRAKE and FIRE buttons and the floating joystick, written to `S.input` once a frame | `connect(actions)` registers the key handlers, which need actions from other modules (start race, mute, leave lab); this is how the modules avoid importing each other in a circle. `win` and `doc` can be passed in, so it is unit-tested with a fake DOM |
| `src/game.js` | `createGame({ S, doc, reset, audio, hud, lab, input, rig, fx })` returns `{ startRace, exitLab, handleEvents }` | Race flow, and the simulation's events turned into sound, toasts and the damage flash. **To add a sound, toast or effect, add a case to `handleEvents()`** |
| `src/camera.js` | `createCameraRig({ S, cam, ranking, angDiff })` returns `{ reset, follow }` | Which car the camera follows and how it eases after it |
| `src/loop.js` | `createLoop({...}).start()`: `frame()` and `tick()` | Re-arms `requestAnimationFrame` first and runs the tick in try/catch; adaptive resolution; sub-stepped sim; attract-mode restart |
| `src/ui/hud.js` | `createHud({...})` returns `{ overlayOpen, visible, toast, showRace, showMenu, showEnd, update }` | HUD, toasts and the three screens. Writes to the DOM only when a value changed |
| `src/ui/settings.js` | `createSettingsUi({...})` returns `{ toggleMute, showAssist, setLevel, hooks }` | The sound, assist and level buttons. `hooks` lets the lab panel follow level and assist changes without an import cycle |
| `src/ui/lab.js` | `createLab({...})` returns `{ setLab, track, resetStats, updateHud, connect }`; `createLapTimer({ S, N })` | The Steering Lab panel and readout. The lap timer is pure and unit-tested |
| `src/ui/debug.js` | `createDebugOverlay({...})` returns `update(now, ft)` | The `?debug` overlay (fps, resolution, sim speed, version, errors) |
| `src/ui/format.js` | `ord`, `fmtTime` | Pure |
| `src/render/view.js` | `createView({ canvas, coarse, startCam })` returns `{ view, cam, resize, canStepDown, stepDown }`; `K`, `TILT`, `RES_STEPS` | The screen metrics (`view.W/H/DPR/Z/baseY`) and the camera (`cam.x/y/a/c/s/shx/shy`) as two explicit objects, not loose variables |
| `src/render/draw.js` | `createDraw({ ctx, view, cam })` returns `{ proj, poly, prism }`; `rgb` and the colour constants | `proj` is the world-to-screen projection (section 4) |
| `src/render/world.js` | `buildProps({ T, N, HALF_W })`: the decorative toy blocks, planks and discs, placed by a seeded generator | Same props on every device; none collide with anything |
| `src/render/minimap.js` | `createMinimap({ canvas, S, T, N })` returns `{ draw }` | The outline is drawn once, offscreen |
| `src/render/scene.js` | `createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion })` returns `{ render }` | Everything drawn on the main canvas, back to front. `fx.hurtFlash` is the one effect the shell controls |
| `src/levels.js` | `LEVELS`, `TUNE_DEFS`, `PRESET_VERSION` and `createSettings(profile)` (the live level and tune values) | Pure data plus logic; unit-tested; tolerant of damaged saved data |
| `src/profile.js` | `createProfile(storage)`: the one versioned JSON document in localStorage | The storage is passed in, so it runs in Node tests; `browserStorage()` returns localStorage or null |
| `src/audio.js` | `createAudio({ getPlayer, doc, AudioContextClass })`: tones, noise, engine hum, mute | Every method is safe at any time (no gesture yet, muted, no WebAudio) |
| `src/diag.js` | `createDiag()`: a small in-memory log of errors (frame failures, uncaught errors, rejected promises) | Shown under `?debug`; remote reporting comes in M3 |
| `src/version.js` | `VERSION` (bumped by hand, a test keeps it equal to `package.json`), `readBuild()` (the deployed commit, from the page's `<meta name="build">`) and `versionLabel()` | Shown at the bottom of the start card (`#ver`, e.g. `v1.4.0 · build 16e20f6`, or `dev build` when run from a checkout) and in the `?debug` overlay. **To cut a release, bump `VERSION` and `package.json` (and `package-lock.json`) together** |
| `src/util.js` | `clamp` | The sim keeps its own copy so it depends on nothing |

Page structure above the module script:

- `<style>`: design tokens in `:root` (`--felt`, `--ink`, `--paper`, `--hot`, `--gold`, `--cool`), then HUD, touch pad and overlay styles.
- `#stage` contains `#c` (main canvas), `#hud` (position, lap, hull bar, weapon, `#mini` minimap canvas, mute button, toasts, countdown), `#pad` (touch controls), `#menu` (start overlay) and `#end` (results overlay).

### Sim: functions to know

| Function | Purpose |
|---|---|
| `buildTrack()` | Catmull-Rom spline through `CTRL` points, resampled to equal spacing (`SP = 22`). Produces arrays `x, y, tx, ty, nx, ny, ang, curv, vsafe`. `vsafe[i]` is the AI's safe corner speed, found by looking ahead and braking back |
| `nearest(px, py, hint)` | Nearest track sample index. Searches near `hint` first, falls back to a full scan |
| `create()` / `reset(S, mode)` | Build state. Modes: `'race'` (countdown) and `'attract'` (AI only) |
| `step(S, dt)` | Advance one frame. Order: countdown, per-car control and drive, walls and lap progress, car-vs-car, crates, bullets, rockets, mines, particles, end-of-race checks |
| `drive(c, dt)` | Arcade car model: forward and lateral velocity split, lateral grip damping, speed-scaled steering |
| `walls(S, c, dt, track)` | Keeps cars inside the track, applies wall damage and counts lap progress via `prog` (index delta, wrap-safe) |
| `aiControl(S, c, dt)` | Lane choice, crate seeking, car avoidance, speed target from `vsafe`, stuck/reverse recovery, weapon use |
| `tryFire(S, c)` | Per-weapon fire logic |
| `hurt` / `destroy` / `explode` | Damage pipeline. `explode` does radial falloff damage and knockback |
| `ranking(S)` | Finished cars first, then alive cars by `prog`, then dead cars |
| `endRace(S, kind)` | `'finish'`, `'wrecked'` or `'last'`. Fills `S.result` |

### Sim to shell communication

The sim pushes plain objects onto `S.events`. The shell drains and clears the array every frame in `handleEvents()` (`src/game.js`). Event types:

`tick`, `go`, `shot {w}`, `boom`, `hit`, `crash`, `hurt {amt}`, `pickup {car,label}`, `empty`, `kill {killer,victim}`, `finish {car}`, `over {kind}`.

To add sounds, toasts or screen effects, add a new event type in the sim and a case in `handleEvents()`.

### Shell and renderer: functions to know

| Function | Purpose |
|---|---|
| `proj(wx, wy, h)` (`src/render/draw.js`) | World to screen. Returns `[sx, sy, perspectiveScale, forwardDistance]` |
| `prism(pts, h0, h1, topCol, sideCol)` (`src/render/draw.js`) | Extruded polygon with back-face culling and per-face shading. Used for walls, props, cars and crates |
| `render()` (`src/render/scene.js`) | Draws the felt, track, then every object sorted by forward depth (painter's algorithm), then particles, fog gradient and damage vignette |
| `update()` (`src/ui/hud.js`) | Writes to the DOM only when a value changed |
| `startRace()` / `exitLab()` (`src/game.js`), `showRace()` / `showMenu()` / `showEnd()` (`src/ui/hud.js`) | Overlay and state transitions |
| `frame()` (`src/loop.js`) | Main loop: input, sim step, events, attract-mode restart, camera follow, render, HUD, engine sound |

## 4. Coordinate system and camera

- World units are about pixels at zoom 1. A car is about 30 units long, the track is 176 wide (`HALF_W = 88`).
- Camera: `cam.x/y/a` follows the target car with a velocity lookahead of 0.075 s and smoothed heading (`kp`, `ka` in `follow()`, `src/camera.js`).
- Projection: `fwd` is distance ahead of the camera and `lat` is sideways. `p = 1 / (1 + fwd * K)`. Screen x is `W/2 + lat*p*Z`, screen y is `baseY - (fwd*TILT + h)*p*Z`.
- `K = 0.0011` sets perspective strength, `TILT = 0.66` sets how far the ground is squashed (lower is flatter), `baseY = H * 0.77` puts the car low on screen, and `Z = clamp(min(W/400, H/500), 0.7, 2.1)` is the responsive zoom.
- Height `h` lifts a point straight up on screen, which is what makes cars and walls look 3D.

## 5. Tuning cheat sheet

All values are in the Sim IIFE unless noted.

| What | Where | Current value |
|---|---|---|
| Laps | `LAPS` | 3 |
| Track width | `HALF_W` | 88 (half-width) |
| Track shape | `CTRL` | 20 control points |
| Player / AI top speed | `newCar` | 372 / 366 |
| Acceleration | `newCar` | 520 |
| AI skill | `newCar` | 0.84 to 0.96 (AI target speed multiplier) |
| AI aggression | `newCar` `ai.aggr` | 0.2 to 0.5 (chance to fire when lined up) |
| Machine gun | `tryFire` | 45 rounds, 0.075 s cooldown, 2.2 dmg per hit, spread 0.07 rad for AI and 0.03 for the player |
| Rockets | `tryFire`, step | 4 rockets, 0.6 s cooldown, homing within 420 units and a 0.7 rad cone, turn rate 1.9 rad/s, blast radius 66, 32 dmg |
| Mines | `tryFire`, step | 3 mines, arm after 0.9 s, blast radius 64, 34 dmg, 30 s lifetime |
| Self damage from own blast | `explode` | 0.4 times |
| Crate drop odds | step, crate block | 20% repair (+40 hull), 36% machine gun, 24% rockets, 20% mines |
| Crate layout / respawn | `reset`, step | 11 groups of 3 (lanes -46, 0, 46), respawn after 11 s |
| Car-car collision damage | step | `(closing speed - 110) * 0.035` |
| Wall damage | `walls` | `(impact speed - 110) * 0.04` |
| Wreck duration | `destroy` | 7 s |
| Camera tilt / perspective | shell | `TILT = 0.66`, `K = 0.0011` |

### 5b. Driving assist and mobile performance

- **Why it exists.** Measured with `tools/driver-study.js`: the same sim with a keyboard-style driver wins most races, but a thumb-style driver (noisy analog steering, gas always on) never wins and averages 5th, losing about 8 s a race to wall scraping (about 7 wall hits vs 0.5). Re-tuning stick gain and smoothing cannot close that gap, so the car now helps.
- **What it does** (`assist()` in the Sim, runs only for the human player when `S.assist` is set): holds the lane the driver is in, steering along the track and away from the walls, with the driver's own steering taking priority (assist weight is `1 - 1.3*|steer|`); and lifts/brakes for corners above `ASSIST_SPEED` (1.1) times the AI's safe speed `vsafe`. It does nothing below 20 units/s so reversing is never fought. With assist, the thumb-driver model wins about 3 of 4 races (avg 2.2nd) with about 0.3 wall hits.
- **Frame rate.** `tick()` catches the sim up in <=1/60 s sub-steps for up to 0.25 s of lag, so the world stays real time on slow phones (it used to run in slow motion below 20 fps). If frames stay slower than 26 ms the canvas resolution steps down (`RES_STEPS`, never back up, to avoid flip-flopping); phones start capped at 1.5x device pixel ratio.
- **Diagnosing a device.** Open the game with `?debug` (for example `.../micro-mayhem/?debug`) to get an overlay with fps, frame time, canvas resolution and sim speed (should read 1.00x).

### 5c. Steering Lab and tuning panel

- **Lab mode.** `reset(S, 'lab')` / `S.lab`: the player alone on the track, no rivals, no crates or weapons, no countdown, damage disabled (`hurt()` returns early), and the race never ends (finish and last-car checks are skipped). Start it from the start screen (STEERING LAB) or open the game with `?lab`. `Esc` or EXIT leaves it. The HUD shows last lap, best lap and wall touches (`S.touches`, counted on the rising edge of the player touching a wall).
- **Difficulty levels.** `LEVELS` (`src/levels.js`) is a registry: each level has `assist` (starts on or off), a one-line `blurb`, and a `tune` object with a default for every tunable. **Veteran**: the owner's tuned defaults, assist off (`assistLane` 0.3, `assistSpeed` 1.1). **Rookie**: the same steering values with assist on and both assist sliders at their maximum (`assistLane` 1.5, `assistSpeed` 1.5; measured with the driver study, "maximum help" for corner speed would be the slider minimum, but that makes the car too slow to win, so Rookie uses the slider maximum). The first-run level is Veteran. `?level=rookie|veteran` selects a level for one visit without saving.
- **Panel.** `TUNE_DEFS` (`src/levels.js`) is the list of tunables (key, label, range, hint); the default *values* live in `LEVELS[level].tune`. The panel builds a slider per entry, switches level (ROOKIE/VETERAN), and has RESET (this level's defaults), COPY (JSON of the current values including the level, for baking in) and the ASSIST toggle. It is a side panel in landscape and a top sheet in portrait so the left thumb can keep driving while the right adjusts sliders.
- **Saved tweaks.** Persistence goes through `Profile` (`src/profile.js`: one versioned JSON document under `mm:profile`; do not add other localStorage keys). Damaged saved data is repaired, never trusted: a profile naming level `constructor` or with non-object presets used to throw during startup (permanently, because it was persisted); `tests/unit/levels.test.js` now covers about 25 hostile shapes. Per level it stores only the values the player changed (`presets[level] = { pv, tune: {changed keys}, assist: null | bool }`), so untouched values follow new defaults. Old pre-profile keys (`mm-tune`, `mm-assist`) are deleted on load.
- **Baking in new defaults.** Paste the COPY output, copy each value into `LEVELS[level].tune` in `src/levels.js` (and `assist`), and **bump `PRESET_VERSION`** so saved tweaks from the old defaults stop hiding the new ones. Check with `?lab` on a profile that has stale saved values.
- **What each tunable does.** `gain` scales the stick; `curve` (>1) makes the centre gentler; `maxLock` caps steering; `speedDamp` reduces steering with speed; `rate` is the smoothing speed; `dead` is the dead zone; `radius` is thumb travel for full deflection (also sizes the stick graphic); `assistLane` scales the assist's lane-hold steering; `assistSpeed` is the corner speed the assist allows, as a multiple of the AI's safe speed. `assistLane` and `assistSpeed` are pushed into `S.tune` every frame and read by `assist()`; the others are shell-only (`readInput()` and `stickMove()`).

## 6. Testing without a browser

Because `Sim` is pure, you can run headless races in plain Node (`package.json` sets `"type": "module"`):

```js
import Sim from './src/sim/sim.js';
const S = Sim.create();
Sim.reset(S, 'race');
S.player.auto = true;            // let the AI drive the player car too
for (let t = 0; t < 200 && S.state !== 'over'; t += 1 / 60) {
  Sim.step(S, 1 / 60);
  S.events.length = 0;           // drain events (the shell normally does this)
}
console.log(S.state, Sim.ranking(S).map(c => `${c.name}:${Math.round(c.hp)}`));
```

### Test suite (added in M0.1)

Dev tooling only; nothing here ships to players. One-time setup: `npm install` (Node 20 or newer; it installs Playwright, which needs its Chromium: `npx playwright install chromium`).

| Command | What |
|---|---|
| `npm test` | Everything below, about 2 minutes |
| `npm run lint` | ESLint: undefined names, dead code, and the simulation's purity rules (CI runs it before the tests) |
| `npm run test:unit` | Unit tests of the small modules (profile, levels, audio, diagnostics, version, the renderer: view, projection and prisms, props, minimap, scene; and input with a fake DOM, the lap timer, text formatting, and that the modules have no import cycles), about 2 s |
| `npm run test:sim` | Headless simulation tests, about 25 s |
| `npm run test:browser` | Real-browser tests: menus, race flow, touch controls, the lab, saved profile, a 9,000-frame soak |
| `npm run study` | The driver study (keyboard-style and thumb-style drivers, with and without assist) |
| `npm run perf` | Main-thread JavaScript cost per frame on a phone-sized screen (real time; noisy) |
| `npm run perf:cpu` | CPU cost per frame in virtual time (about 1% noise); compare before and after a refactor in alternating runs, as `tools/perf-compare.sh` does for the real-time measure |
| `tools/golden-compare.sh <commit>` | **Did a refactor change any pixel?** Renders 19 deterministic scenarios (81 frames: attract mode on three screen shapes, countdown and start, every entity and effect, wrecks, hit flash, shake, reduced motion, the lab, the settings buttons, keyboard and touch controls, the lab panel, all three results screens) from that commit and from the working tree, and compares the exact pixels of the canvas and minimap **and the state of the HUD, overlays, buttons and input values**. About 2 minutes. `npm run golden` runs the capture and compare steps by hand |
| `npm run serve` | Local web server on port 8000 |

**Randomness in tests.** The sim is not seeded until M1, so races vary. Never assert a threshold you have not measured: run the scenario 100+ times, look at the distribution, and size the sample so a false failure is well under 0.1% per run. Two tests written without that discipline failed on CI within an hour (an autopilot race can end in 14.5 s; a random-input race may never finish). Assert invariants (finite, within limits) rather than outcomes wherever you can.

`docs/M0-baseline.md` records the numbers every refactor must reproduce. Tests open the game with `?debug`, which exposes `window.__mm` (`S`, `input`, `Sim`, `tune`, `level`); keep that hook working. Any change to physics, steering, defaults or the profile should be followed by `npm test`; changing a baked-in default also means updating `tests/browser/lab.test.js` and bumping `PRESET_VERSION`.

Checks worth keeping when you change physics or the track:

- No `NaN` in car positions after a long run.
- The track never comes within about `2 * HALF_W + 40` of itself (otherwise lanes overlap on tight S-bends). The current minimum is about 429.
- With the autopilot as the player, races finish in about 70 to 85 s and roughly half end by combat before the line.

The renderer is tested in Node against a **strict fake canvas** (`tests/helpers/fakes.js`) that throws on a negative arc or ellipse radius, as a real canvas does, and also rejects NaN coordinates. That makes the freeze bug (section 9) a fast unit test. The renderer guards in two independent layers (depth culling, and clamping radii), so a test that removes only one layer correctly still passes; it fails when both are gone.

## 7. Known limitations and caveats

- **Freeze bug, fixed (v1.3).** Rockets and shockwave rings were not culled, so a distant AI-vs-AI explosion threw `IndexSizeError` in `render()` and the loop stopped. See section 9.

- **Not verified on real devices.** The logic, the renderer (against a fake canvas), the menus, the HUD state and the touch controls (with synthetic touches) are tested in headless Chromium. Still unverified: how the touch controls *feel* on real phones (tune it in the Steering Lab, section 5c), how the HUD and overlays look at unusual screen sizes, and all audio (tests only check that nothing throws). Check these first.
- **Props are decorative.** The felt-table clutter (blocks, planks, discs) sits off the track and has no collision, so it cannot be used as an obstacle yet.
- **AI is simple.** It follows a lane offset, brakes to `vsafe`, and aims by lining up in front of a target. It does not dodge incoming fire or plan overtakes.
- **Difficulty is one fixed setting.** The player's top speed is 372. AI cars cap at 366 times their skill (0.84 to 0.96, randomised per race), so even the best AI car is slower than a clean human lap.
- **Single track, single mode.** There is no pause, no best-time storage, no track select and no difficulty select.
- **Rendering cost.** `nearest()` full-scans when the hint is lost, and prop placement runs an O(props x track) check at startup. Both are fine at current sizes.
- **Accessibility.** Screen shake is disabled under `prefers-reduced-motion`. There is no colour-blind mode, and the AI cars are told apart only by colour and name toasts.

## 8. Suggested next steps

**The current plan and build order are in `docs/ROADMAP.md` (section 7); the list below is the original v1 wish list and is partly superseded.**

Roughly in order of payoff:

1. **Play-test and tune.** Check handling at phone and desktop sizes, then adjust `LATACC`, steering rate and the damage numbers.
2. **Pause menu and difficulty** (AI skill and aggression presets).
3. **Best times and records** with `localStorage` (wrapped in try/catch), shown on the results screen.
4. **More tracks.** `CTRL` is just a point list, so add a track array and a picker. Check separation with the test in section 6.
5. **Solid props and ramps** (circle colliders in `walls`-style code, plus a boost pad).
6. **Better AI.** Dodge rockets, drive through mines on purpose, and prefer targets in range.
7. **More weapons.** Oil slick, shield, boost, shotgun.
8. **Split-screen or networked multiplayer.** The sim is already state-in, state-out, so a second human input in `S.input` is a small first step.
9. **Move to modules.** Split into `sim.js`, `render.js`, `audio.js`, `ui.js`, `index.html` with a bundler or native ES modules.

## 9. Conventions used

- Plain browser JavaScript as ES modules, no runtime dependencies (dev tooling only: Playwright and ESLint). The shell is a set of small `createX({...})` modules wired in `src/main.js`; **modules never import each other in a circle** (a unit test checks it). Where one needs an action from another, `main.js` passes it in (`input.connect(actions)`, `lab.connect(actions)`, `settingsUi.hooks`).
- **Lint is part of the build.** `npm run lint` must be clean; CI runs it before the tests. Do not weaken the `src/sim/` rules to make a change compile: pass the data in instead.
- Design tokens are CSS variables in `:root`. The look is a dark felt table with chunky toy props, a pop-art red/gold/cyan palette, Bungee for headings and numbers, and Barlow Condensed for UI text.
- DOM is touched only through cached element references and only when a value changes.
- Canvas drawing uses the sim's world coordinates through `proj()`. Nothing in the sim knows about the screen.
- **Cull everything you draw.** `proj()` returns a negative perspective scale for points more than ~900 units behind the camera, and canvas `arc()`/`ellipse()` *throw* on a negative radius. Every object type in `render()` is depth-culled (`-260 < fwd < 1050`) and radii are clamped with `Math.max(0, ...)`. Anything new that can exist far from the player (AI-vs-AI rockets, explosions, mines) must follow the same rule.
- **The main loop must not die.** `frame()` re-arms `requestAnimationFrame` first and runs `tick()` inside try/catch, so one bad frame logs to the console instead of freezing the game forever. If you see `console.error` output during play, that is a real bug to fix, not noise.
- **Test, then deploy, then verify (`.github/workflows/pages.yml`).** Every push to any branch runs the `test` job (`npm run test:ci`, about 2.5 minutes). The `deploy` job `needs` it and runs only on `main`, so a failing test blocks the deploy and branch pushes never try to deploy (the `github-pages` environment accepts `main` only; a branch deploy used to fail, and when the same commit was pushed to `main` and a branch, the branch run cancelled the `main` run, so several builds silently never went live). `tools/stage-site.mjs` builds the folder that is published (only `index.html`, and later `src/` and `fonts/`; never tests, tools or docs) and stamps the commit into `<meta name="build">` and `build.txt`. A last step (`tools/verify-live.sh`) fetches **every published file** from the live site with a cache-buster and fails the run unless each one is byte-identical to what was staged, so a green run means the change is live and complete. Deploys queue rather than cancel each other.
- **Push to `main`; confirm the run.** Work on the branch you are given, then push the same commit to `main` to release. Check the run is green before telling anyone a change is live; if the `test` job is red, nothing was deployed and the live site is still the previous build.
