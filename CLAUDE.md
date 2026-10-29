# Micro Mayhem: project documentation

A top-down, slightly pseudo-3D toy-car combat racer. Six cars, three laps, a looping track with multiple turns, pickup weapons, damage and destruction. Everything lives in one file, `index.html`, with no build step and no assets.

This file is the project context for Claude Code. The game is deployed to GitHub Pages from `.github/workflows/pages.yml`.

---

## 1. Run it

- Open `index.html` in a browser, or serve the folder (`npx serve .` or `python3 -m http.server`).
- The only network dependency is Google Fonts (Bungee for display, Barlow Condensed for UI). Both have system fallbacks, so the game works offline.
- Desktop: arrow keys or WASD to steer and accelerate, Space or F or Shift to fire, `M` to mute, Enter or Space to start from a menu.
- Touch: an on-screen control scheme appears on the first touch. Left thumb: floating drive joystick. Left thumb down = gas always on; x steers (analog, gain `STICK_STEER_GAIN`, full lock at about 45% deflection, almost unsmoothed via `STICK_STEER_RATE`). The base appears where the thumb lands and trails it when it leaves `STICK_R`. Right thumb: FIRE button, plus a small BRAKE/REVERSE button beside it. **Driving assist** (see section 5b) is on by default on touch devices and off on desktop; toggle it from the start screen or the HUD, the choice is stored in `localStorage` (`mm-assist`).

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

The whole script is two IIFEs inside one `<script>`:

1. **`const Sim = (() => { ... })()`** is the simulation. It is pure: no DOM, no canvas, no audio, no `window`. It ends with `if (typeof module !== 'undefined') module.exports = Sim;`, so you can lift it into its own file and run it in Node for tests.
2. **`(() => { ... })()`** is the game shell. It holds the canvas and camera, audio, input, HUD and overlays, the renderer (props, minimap, `render()`) and the main loop. It reads state from `Sim` and writes only to `S.input`.

Page structure above the script:

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

The sim pushes plain objects onto `S.events`. The shell drains and clears the array every frame in `handleEvents()`. Event types:

`tick`, `go`, `shot {w}`, `boom`, `hit`, `crash`, `hurt {amt}`, `pickup {car,label}`, `empty`, `kill {killer,victim}`, `finish {car}`, `over {kind}`.

To add sounds, toasts or screen effects, add a new event type in the sim and a case in `handleEvents()`.

### Shell: functions to know

| Function | Purpose |
|---|---|
| `proj(wx, wy, h)` | World to screen. Returns `[sx, sy, perspectiveScale, forwardDistance]` |
| `prism(pts, h0, h1, topCol, sideCol)` | Extruded polygon with back-face culling and per-face shading. Used for walls, props, cars and crates |
| `render()` | Draws the felt, track, then every object sorted by forward depth (painter's algorithm), then particles, fog gradient and damage vignette |
| `updateHud()` | Writes to the DOM only when a value changed |
| `startRace()` / `showEnd()` | Overlay and state transitions |
| `frame()` | Main loop: input, sim step, events, attract-mode restart, camera follow, render, HUD, engine sound |

## 4. Coordinate system and camera

- World units are about pixels at zoom 1. A car is about 30 units long, the track is 176 wide (`HALF_W = 88`).
- Camera: `cam.x/y/a` follows the target car with a velocity lookahead of 0.075 s and smoothed heading (`kp`, `ka` in `frame()`).
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

## 6. Testing without a browser

Because `Sim` is pure, you can run headless races. Save the `Sim` IIFE to `sim.js` (keep the `module.exports` line) and:

```js
const Sim = require('./sim.js');
const S = Sim.create();
Sim.reset(S, 'race');
S.player.auto = true;            // let the AI drive the player car too
for (let t = 0; t < 200 && S.state !== 'over'; t += 1 / 60) {
  Sim.step(S, 1 / 60);
  S.events.length = 0;           // drain events (the shell normally does this)
}
console.log(S.state, Sim.ranking(S).map(c => `${c.name}:${Math.round(c.hp)}`));
```

`node tools/driver-study.js [runs]` pulls the Sim out of `index.html` and compares keyboard-style and thumb-style drivers with and without assist. Re-run it after any change to physics, steering or the assist.

Checks worth keeping when you change physics or the track:

- No `NaN` in car positions after a long run.
- The track never comes within about `2 * HALF_W + 40` of itself (otherwise lanes overlap on tight S-bends). The current minimum is about 429.
- With the autopilot as the player, races finish in about 70 to 85 s and roughly half end by combat before the line.

The renderer can be checked in Node with `@napi-rs/canvas`: stub `document`, `window` and `requestAnimationFrame`, call the frame callback repeatedly, and save the canvas as a PNG.

## 7. Known limitations and caveats

- **Freeze bug, fixed (v1.3).** Rockets and shockwave rings were not culled, so a distant AI-vs-AI explosion threw `IndexSizeError` in `render()` and the loop stopped. See section 9.

- **Not tested in a real browser.** I could only run the logic and a Node canvas render. Still unverified: the HTML HUD and overlay layout, the touch control feel (joystick radius, dead zone, gain and smoothing are `STICK_R`, `STICK_DEAD`, `STICK_STEER_GAIN`, `STICK_STEER_RATE`), and all audio. Check these first.
- **Props are decorative.** The felt-table clutter (blocks, planks, discs) sits off the track and has no collision, so it cannot be used as an obstacle yet.
- **AI is simple.** It follows a lane offset, brakes to `vsafe`, and aims by lining up in front of a target. It does not dodge incoming fire or plan overtakes.
- **Difficulty is one fixed setting.** The player's top speed is 372. AI cars cap at 366 times their skill (0.84 to 0.96, randomised per race), so even the best AI car is slower than a clean human lap.
- **Single track, single mode.** There is no pause, no best-time storage, no track select and no difficulty select.
- **Rendering cost.** `nearest()` full-scans when the hint is lost, and prop placement runs an O(props x track) check at startup. Both are fine at current sizes.
- **Accessibility.** Screen shake is disabled under `prefers-reduced-motion`. There is no colour-blind mode, and the AI cars are told apart only by colour and name toasts.

## 8. Suggested next steps

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

- Plain browser JavaScript, no dependencies, `'use strict'` inside both IIFEs.
- Design tokens are CSS variables in `:root`. The look is a dark felt table with chunky toy props, a pop-art red/gold/cyan palette, Bungee for headings and numbers, and Barlow Condensed for UI text.
- DOM is touched only through cached element references and only when a value changes.
- Canvas drawing uses the sim's world coordinates through `proj()`. Nothing in the sim knows about the screen.
- **Cull everything you draw.** `proj()` returns a negative perspective scale for points more than ~900 units behind the camera, and canvas `arc()`/`ellipse()` *throw* on a negative radius. Every object type in `render()` is depth-culled (`-260 < fwd < 1050`) and radii are clamped with `Math.max(0, ...)`. Anything new that can exist far from the player (AI-vs-AI rockets, explosions, mines) must follow the same rule.
- **The main loop must not die.** `frame()` re-arms `requestAnimationFrame` first and runs `tick()` inside try/catch, so one bad frame logs to the console instead of freezing the game forever. If you see `console.error` output during play, that is a real bug to fix, not noise.
