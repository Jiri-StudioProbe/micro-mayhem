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
| UI | Start screen, HUD (position, lap, hull bar, weapon and ammo, minimap), toasts, countdown, results screen with your records (race time and best lap against your bests, per level and assist setting) |
| Players | A household of up to 8 players on one device (M3.1): "Who's playing?", add, rename, delete; each has their own level, races and bests; the start screen, results and records say who. A **family board** ranks them on each level and assist setting (M3.1c, the end of M3.1). The **sync engine** exists and is tested against a fake backend (M3.2), but nothing uses it yet: there is no backend (M3.3) and no sign-in (M3.4) |
| Audio | Synthesised with WebAudio (engine, shots, explosions, pickups, countdown) |
| Attract mode | The start screen runs an AI-only race in the background |

## 3. File structure

The game is an ES module graph. `index.html` loads `src/main.js`, which imports the rest:

| Module | What it is | Notes |
|---|---|---|
| `src/sim/sim.js` | The simulation (`import { Sim } from './sim/sim.js'`, also the default export) | **Pure**: no DOM, canvas, audio, storage, timers, network or `console`. Enforced by lint (`eslint.config.js` gives `src/sim/` no host globals, bans importing the shell, bans `Date`/`globalThis`). Moved out of the page byte for byte in M0.4 |
| `src/sim/rng.js` | `mulberry32(seed)` returns a function giving the next number in [0, 1); `deriveSeed(seed, salt)` makes independent streams from one seed | The sim's only source of randomness (M1.1). Pinned by tests: **changing the algorithm or its constants breaks every saved race** |
| `src/main.js` | The shell: builds every piece below and wires them together (about 80 lines, no logic). Also the `?level=`, `?lab` and `?debug` handling and the `window.__mm` hook | Moved out of the page byte for byte in M0.5a, then split into the modules below in M0.5 to M0.7 |
| `src/input.js` | `createInput({ S, tune, initAudio })` returns `{ readInput, stickRelease, connect }`: keyboard, BRAKE and FIRE buttons and the floating joystick, written to `S.input` once a frame | `connect(actions)` registers the key handlers, which need actions from other modules (start race, mute, leave lab); this is how the modules avoid importing each other in a circle. `win` and `doc` can be passed in, so it is unit-tested with a fake DOM |
| `src/game.js` | `createGame({ S, doc, reset, audio, hud, lab, input, rig, fx })` returns `{ startRace, exitLab, handleEvents }` | Race flow, and the simulation's events turned into sound, toasts and the damage flash. **To add a sound, toast or effect, add a case to `handleEvents()`** |
| `src/camera.js` | `createCameraRig({ S, cam, ranking, angDiff })` returns `{ reset, follow }` | Which car the camera follows and how it eases after it |
| `src/loop.js` | `createLoop({...}).start()`: `frame()` and `tick()` | Re-arms `requestAnimationFrame` first and runs the tick in try/catch; adaptive resolution; fixed simulation steps; attract-mode restart. Per frame: fixed steps (each: `interp.snapshot()`, `readInput(STEP)`, `step(S, STEP)`), events, then `interp.apply(alpha)`, camera and `render()`, `interp.restore()`, HUD |
| `src/stepper.js` | `createStepper({ STEP, maxLag })` returns `{ advance(dt, onStep), reset }` | The fixed-step clock: how many whole steps real time has earned and how far the next is under way (`alpha`). Pure and unit-tested |
| `src/interp.js` | `createInterp({ S, angDiff })` returns `{ snapshot, apply(alpha), restore }` | Render interpolation: draws cars, bullets, rockets and particles between their last two simulated positions; the real state is always restored, so the sim never sees an interpolated value |
| `src/ui/hud.js` | `createHud({..., who })` returns `{ overlayOpen, visible, toast, showRace, showMenu, showEnd(info), update }` | HUD, toasts and the three screens (`showEnd` also fills the records block from `describeBests(info)`, and puts the name of the player, `who()`, after the headline: `CHEQUERED FLAG · ADA`). Writes to the DOM only when a value changed |
| `src/ui/settings.js` | `createSettingsUi({...})` returns `{ toggleMute, showAssist, setLevel, reload, hooks }` | The sound, assist and level buttons. `reload()` takes up the level (and assist) of whoever plays now and refreshes the buttons. `hooks` lets the lab panel follow level and assist changes without an import cycle |
| `src/ui/lab.js` | `createLab({...})` returns `{ setLab, track, resetStats, updateHud, connect }`; `createLapTimer({ S, N })` | The Steering Lab panel and readout. The lap timer is pure and unit-tested |
| `src/ui/debug.js` | `createDebugOverlay({...})` returns `update(now, ft)` | The `?debug` overlay (fps, resolution, sim speed, version, errors) |
| `src/ui/format.js` | `ord`, `fmtTime(t, digits = 1)` | Pure. `fmtTime` rounds before splitting, so 59.97 s reads `1:00.0`, never `0:60.0` |
| `src/ui/router.js` | `createRouter({ screens, win })` returns `{ go, push, back, clear, current, depth, canGoBack, subscribe }` | **The only thing that shows or hides a screen** (`#menu`, `#end`, `#history`, `#detail`, `#backup`, `#players`, `#player`, `#family`); never toggle their `hidden` yourself. `go(id)` makes a screen the only one, `push(id)` opens one on top (the records from the menu or the results; a race's details from the records), `back()` returns, `clear()` is a race. With `win` every push is a browser history entry, so the phone's Back button closes the screen instead of leaving the game; the popstate handler is driven by the stack alone (no counters), so it cannot get out of step |
| `src/ui/history.js` | `describeBoards(bests)`, `describeRace(rec, fmtDate)`, `describeDetail(rec, fmtDate)`, `defaultFmtDate` | Pure: what the records screens say (one list line per race, one race in full, your bests per board). The date formatter is passed in so tests do not depend on the machine's time zone |
| `src/ui/historyui.js` | `createHistoryUi({ doc, router, Profile })` returns `{ render, show, open, focusFor }` | The records screens' DOM: your bests, the list of races (newest first, 40 at a time), and one race's details. **Sets text only, never markup**: every string came from storage. Reopening the list from a race's details restores the scroll position and the focus |
| `src/ui/players.js` | `describeWho(c)`, `describePlayers(characters, currentId)`, `describePlayer(c, count)`, `describeError(code)` | Pure: what the players screens say (the start screen's button, `PLAYING AS ADA · CHANGE`, or `WHO ARE YOU? SET YOUR NAME` for an unused Player; one row per character with level and race count; one sentence for each way adding or renaming is refused). Every name is only ever shown with `textContent` |
| `src/ui/playersui.js` | `createPlayersUi({ doc, router, Profile, settingsUi })` returns `{ refreshWho, renderList, show, focusFor }` | The "Who's playing?" screen (`#players`: tap a player to play as them, EDIT, + NEW PLAYER, up to 8) and the one-player screen (`#player`: a name box, ADD PLAYER or SAVE NAME, DELETE PLAYER, which asks twice). Choosing someone saves them as the device's player and calls `settingsUi.reload()`, because **the level is the character's**; adding one makes them the player; finishing goes to the start screen with `router.go('menu')` (never two `back()` calls in a row: the second Back would be undone as a Forward). Enter in the name box saves |
| `src/ui/family.js` | `listBoards(characters)`, `defaultBoard(boards, current, assistOn)`, `rankBoard(characters, key, by, currentId)` | **The family board (M3.1c), pure.** Nothing is stored for it: it is read from each character's `bests` (kept for ever). A board is `track/level/assist`, exactly as in the personal bests, so a Rookie with assist and a Veteran without are never ranked against each other. `rankBoard` ranks by race time (`'time'`) or best lap (`'lap'`), smaller is better; equal values share a rank (1, 1, 3) and are ordered by name; someone with a best lap but no finished race is listed below the ranked, unranked; players with nothing on the board are returned separately (`none`). `defaultBoard` is the player's own level and assist, else a board they have raced on |
| `src/ui/familyui.js` | `createFamilyUi({ doc, router, Profile, assistOn })` returns `{ show, render, refreshButtons, focusFor }` | The Family board screen (`#family`): board chips, RACE TIME or BEST LAP, the table, and who has not raced there. Opened by FAMILY BOARD on the start screen and on "Who's playing?", **which exist only for a household of two or more** (and are empty, not just hidden, otherwise, so a single player's start screen is unchanged). They follow the household through `router.subscribe`. Opens on the player's own board each time. Text only |
| `src/ui/results.js` | `describeBests(info)`: the words and numbers of the results screen's records block; `describeResult(r)`: the headline of an ending | Pure and unit-tested. `info` is what `recorder.recordRace` returned (`game.lastRace()`): rows for race time and best lap, each with this race, your best, and a tag (`NEW BEST`, `+0.82 s`, `TIED BEST`); a note naming the board (`VETERAN · NO ASSIST`) or explaining a race that sets no record |
| `src/render/view.js` | `createView({ canvas, coarse, startCam })` returns `{ view, cam, resize, canStepDown, stepDown }`; `K`, `TILT`, `RES_STEPS` | The screen metrics (`view.W/H/DPR/Z/baseY`) and the camera (`cam.x/y/a/c/s/shx/shy`) as two explicit objects, not loose variables |
| `src/render/draw.js` | `createDraw({ ctx, view, cam })` returns `{ proj, poly, prism }`; `rgb` and the colour constants | `proj` is the world-to-screen projection (section 4) |
| `src/render/world.js` | `buildProps({ T, N, HALF_W })`: the decorative toy blocks, planks and discs, placed by a seeded generator | Same props on every device; none collide with anything |
| `src/render/minimap.js` | `createMinimap({ canvas, S, T, N })` returns `{ draw }` | The outline is drawn once, offscreen |
| `src/render/scene.js` | `createScene({ S, ctx, view, cam, fx, draw, props, T, N, HALF_W, reducedMotion })` returns `{ render }` | Everything drawn on the main canvas, back to front. `fx.hurtFlash` is the one effect the shell controls |
| `src/levels.js` | `LEVELS`, `TUNE_DEFS`, `PRESET_VERSION` and `createSettings(profile)` (the live level and tune values; also `reload()`) | Pure data plus logic; unit-tested; tolerant of damaged saved data. The **level belongs to the character who is playing** (`Profile.current().level`, so a child can stay on Rookie); the tuning (`presets`) belongs to the device. `reload()` takes up the level of whoever plays now |
| `src/backup.js` | `encodeBackup(doc)`, `decodeBackup(text)`, `mergeProfiles(local, imported, { legacyTo })`, `previewImport(local, imported, rawCount, { legacyTo })`, `rawRaceCount`, `isLegacyDoc`, `crc32` | Backup codes: `MMP1:<z or r>:<crc-32>:<base64url>`, the profile JSON deflated (z) or raw (r). Decoding never trusts a code: whitespace is ignored, a check catches a truncated or altered code, sizes are limited before and after unpacking (a tiny code can unpack into gigabytes), and the result still goes through `cleanProfileDoc`. **Merging** keeps this device's settings and matches **characters by id**: a character that is here gets the races it lacks (by id, this device's copy wins, date order, latest 500) and the better of each best, one this device lacks is added (names kept different; a household holds 8), names and levels here stay. **On a new device** (only an unused default Player, `isPristine`) the code's characters replace it and the first plays. A player this household deleted comes back from a backup as a **new** character with a new id (`makeId`). **A code from before players** (version 1 or 2, `isLegacyDoc`) has no characters: merging adds its races to the character who plays (`legacyTo`); replace makes it one character, Player. **Replace** (a separate action) takes the code's whole profile |
| `src/ui/backupui.js` | `createBackupUi({ doc, router, Profile })` | The Backup screen (BACKUP on the records screen): the code to copy or save as a file, and a place to paste or load one, check it (a preview says what it holds and what merging or replacing would do), then ADD TO THIS DEVICE or REPLACE EVERYTHING (two taps). Restoring writes the profile and **reloads the page**, so every part of the game starts again from what is stored. Text only, never markup; leaving the screen forgets what was pasted |
| `src/profile.js` | `createProfile(storage, ctx)`: the one versioned JSON document in localStorage (**version 3**: `household`, `characters`, `settings` = this device's `{ presets, character }`, `updatedAt`) returning `{ data, save, replace, current, setCurrent, setLevel }`; `cleanProfileDoc(raw, ctx)` | The storage is passed in, so it runs in Node tests; `browserStorage()` returns localStorage or null. `ctx` (`{ newId, now }`) is for tests. Loading and importing both go through `cleanProfileDoc` (damaged records and characters are dropped, the rest kept, older versions migrated, a newer game's version and unknown fields kept, a `__proto__` field harmless). **Migration 2 to 3:** the old top-level `races`, `bests` and `settings.level` become one character, "Player"; `races` or `bests` still at the top later (a stale cached page saved a race) are added to the character who plays. `current()` is the character who is playing (always one); `setCurrent(id)` and household changes mutate `data` and the caller saves. `replace` writes to storage first and says whether that worked; nothing changes if it did not, and it **clears `settings.sync`** (a restore brings races the server may not have, so the next sync starts by finding out) |
| `src/household.js` | `cleanName`, `uniqueName`, `cleanCharacters`, `cleanHousehold`, `newCharacter`, `addCharacter`, `renameCharacter`, `removeCharacter`, `setCurrent`, `currentCharacter`, `mergeCharacter`, `isPristine`; `MAX_CHARACTERS` (8), `NAME_MAX` (16) | **The household model (M3.1; see `docs/ROADMAP.md` section 5b).** A household is a random id plus characters; a character is `{ id, name, level, createdAt, updatedAt, races, bests }`, i.e. **a small profile of its own**: `races` (the latest 500) and `bests` are exactly what a version 2 profile held at the top, so `src/records.js` works on a character unchanged. Names are the one free text in the profile: control, zero-width, direction-override and lone-surrogate characters are removed, white space collapsed, cut to 16, and kept different (case ignored); always shown with `textContent`. A race id is unique in the household. The last character cannot be removed. **Deleting a character leaves a tombstone** in `household.deleted` (`{ id: when }`, the newest 200), so other devices can be told; a deleted id is gone for good. Pure and unit-tested |
| `src/net/backend.js` | `BackendError(kind, message)`, `errorKind(e)`; the **backend contract** in its header | What the game needs from whatever stores a household online (M3.2): `getMeta`, `putMeta`, `putRaces`, `listRaces({ after, limit })`, `listRaceIds`, `deleteHousehold`, all async, for one household; failures are `'offline'`, `'denied'` or `'server'`. The sync engine is written against this only, so the provider (M3.3) is an adapter. **Not used by the game yet**: M3.4 wires it |
| `src/net/merge.js` | `mergeMeta(a, b)`, `mergeRow`, `mergeBestsStable`, `cleanMeta(raw)`, `metaOf(data)`, `rowOf`, `metaEqual`, `canonical`, `fitHousehold(meta, now)`, `orderRows` | **How two copies of a household become one (pure).** The shared state is the *meta*: each character's row (everything but races) and the tombstones. `mergeMeta` is a **join** (commutative, associative, idempotent; `tests/unit/net-merge.test.js` checks it on 3,000 random cases each), so devices that sync in any order end up identical. Name, level and unknown fields: the later `updatedAt` wins (a tie is broken by the rows' own text); personal bests: the better of each board (a tie by race id); **deleting always wins** (a tombstone removes the character whatever changed elsewhere later; an earlier version where a later change could outvote it was found by the property test to be non-associative). `cleanMeta` cleans everything from a server. `fitHousehold` applies the 8-player limit and unique names the same way on every device |
| `src/net/sync.js` | `createSync({ Profile, backend, now, setTimer, clearTimer, onChange, onStatus, pageSize, batchSize, backoff, quiet })` returns `{ status, kick, syncNow, queueRace, resume, stop }` | **The sync engine (M3.2).** One sync: merge the meta with the server's (send it back if the server lacked something), upload the races in the **outbox**, download the races since the **cursor**. Races never change, so they need no merging, only collecting by id; both the outbox and the cursor live in `settings.sync` and are saved after every step, so a cut-off sync carries on and a race sent twice is stored once. A first sync (or the first after a restore, which clears `settings.sync`) asks which races the server has. A new device's unused Player makes way for the household's characters. Errors: offline and server errors are retried after 1, 2, 4 ... s (at most 5 min); **denied** stops until `resume()` or `syncNow()`. `kick()` coalesces a burst into one sync; `status()` is `{ state, pending, error, lastSyncAt }` (`pending` counts races not yet on the server, plus 1 for the household part). **Nothing in the game uses it yet** (M3.4): it is tested against `tests/helpers/fakebackend.js`, a fake server with the real rules that can go offline, refuse, and lose a response after storing the change |
| `src/records.js` | `makeRecord`, `cleanRecord`, `cleanRaces`, `updateBests`, `addRace`, `createRecorder({ Profile, appVersion, getLevel })` | (The recorder saves into the history of the character who is playing, `Profile.current()`; the history cap and the bests are per character. `onRecord(record, characterId)` tells the sync about each new race; it can throw without costing the race.) Race records (`{ id, ts, appVersion, simVersion, track, laps, level, config, result }`, about 385 bytes each) and personal bests per `track/level/assist` (`assist`, `manual`; a race where assist was toggled counts for none). The history keeps the latest 500 races; bests are kept for ever. **Everything read from storage goes through `cleanRecord`**; unknown fields of a record are kept. `game.js` records every race that ends (not the lab or the demo) |
| `src/audio.js` | `createAudio({ getPlayer, doc, AudioContextClass })`: tones, noise, engine hum, mute | Every method is safe at any time (no gesture yet, muted, no WebAudio) |
| `src/diag.js` | `createDiag()`: a small in-memory log of errors (frame failures, uncaught errors, rejected promises) | Shown under `?debug`; remote reporting comes in M3 |
| `src/version.js` | `VERSION` (bumped by hand, a test keeps it equal to `package.json`), `readBuild()` (the deployed commit, from the page's `<meta name="build">`) and `versionLabel()` | Shown at the bottom of the start card (`#ver`, e.g. `v1.4.0 · build 16e20f6`, or `dev build` when run from a checkout) and in the `?debug` overlay. **To cut a release, bump `VERSION` and `package.json` (and `package-lock.json`) together** |
| `src/util.js` | `clamp`, `newSeed`, `newId`, `ownCopy` | The sim keeps its own copy so it depends on nothing. `newId` is a random id (a UUID where the browser has one); `ownCopy` copies an object's own fields except `__proto__` (stored data is untrusted) |

Page structure above the module script:

- `<style>`: design tokens in `:root` (`--felt`, `--ink`, `--paper`, `--hot`, `--gold`, `--cool`), then HUD, touch pad and overlay styles.
- `#stage` contains `#c` (main canvas), `#hud` (position, lap, hull bar, weapon, `#mini` minimap canvas, mute button, toasts, countdown), `#pad` (touch controls), and the screens, one overlay each: `#menu` (start), `#end` (results), `#history` (the playing character's bests and races; its kicker says whose), `#detail` (one race), `#backup`, `#players` (who is playing), `#player` (one player: add, rename, delete) and `#family` (the family board). Only the router shows them. The start card has `#whoBtn`, which opens `#players`.

### Sim: functions to know

| Function | Purpose |
|---|---|
| `buildTrack()` | Catmull-Rom spline through `CTRL` points, resampled to equal spacing (`SP = 22`). Produces arrays `x, y, tx, ty, nx, ny, ang, curv, vsafe`. `vsafe[i]` is the AI's safe corner speed, found by looking ahead and braking back |
| `nearest(px, py, hint)` | Nearest track sample index. Searches near `hint` first, falls back to a full scan |
| `create(seed)` / `reset(S, config)` | Build state. A **RaceConfig** is plain data, `{ mode, seed, assist, tune: { assistLane, assistSpeed } }`, that with the steps' inputs fully determines a race. Modes: `'race'` (countdown), `'attract'` (AI only) and `'lab'`. Without a `seed` in the config, `reset` draws the next one from the master stream that `create(seed)` made, so a whole session is reproducible; `S.config` is the normalized config *with the seed actually used*, `S.simVersion` the rules it was played under, `S.seed`, `S.lab` and `S.attract` conveniences. `reset(S, 'race', seed)` is shorthand for a config with only a mode and a seed. The shell builds every race's config in `main.js` (`raceConfig(mode)`: the player's current level, assist and tuning) and calls `create(newSeed())` once |
| `makeConfig(c)` / `configProblems(c)` / `raceHeader(S)` | `makeConfig` fills in defaults and repairs anything (never throws): the shell's path. `configProblems` lists what is wrong with a config without repairing it: **use it on anything loaded from storage**. `raceHeader(S)` is `{ simVersion, config }` as plain JSON: what a saved race stores so it can be replayed |
| `step(S, dt)` | Advance one step. **The shell always passes `Sim.STEP` (1/60 s)**; the sim copes with other values (a test feeds 0.2 s) but a race is only repeatable when it is stepped with the same dt each time. Order: countdown, per-car control and drive, walls and lap progress, car-vs-car, crates, bullets, rockets, mines, particles, end-of-race checks |
| `drive(c, dt)` | Arcade car model: forward and lateral velocity split, lateral grip damping, speed-scaled steering |
| `walls(S, c, dt, track)` | Keeps cars inside the track, applies wall damage and counts lap progress via `prog` (index delta, wrap-safe) |
| `aiControl(S, c, dt)` | Lane choice, crate seeking, car avoidance, speed target from `vsafe`, stuck/reverse recovery, weapon use |
| `tryFire(S, c)` | Per-weapon fire logic |
| `hurt` / `destroy` / `explode` | Damage pipeline. `explode` does radial falloff damage and knockback |
| `ranking(S)` | Finished cars first, then alive cars by `prog`, then dead cars |
| `endRace(S, kind)` | `'finish'`, `'wrecked'` or `'last'`. Fills `S.result` |

### Sim to shell communication

The player's lap times (`S.laps`) and whether assist was toggled during the race (`S.assistChanged`) are tracked by the sim as bookkeeping (they feed nothing back, so they are not rules) and end up in `S.result` with `bestLap` and `wallTouches`.

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
- **Frame rate and fixed steps (M1.2).** The sim advances in exact 1/60 s steps (`Sim.STEP`) whatever the frame rate: a 120 or 144 Hz screen takes a step every other frame, a 30 fps phone two steps per frame, up to 0.25 s of lag is caught up (15 steps) and anything beyond is dropped. The renderer draws the moment between the last two steps (`src/interp.js`), so motion is smooth at any refresh rate. Costs, by design: the picture is up to one step (16.7 ms) behind the simulation, and input is read once per step, so steering smoothing no longer varies with frame rate (it is the 60 Hz behaviour everywhere; it used to be rougher on 120 Hz screens). If frames stay slower than 26 ms the canvas resolution steps down (`RES_STEPS`, never back up, to avoid flip-flopping); phones start capped at 1.5x device pixel ratio.
- **Diagnosing a device.** Open the game with `?debug` (for example `.../micro-mayhem/?debug`) to get an overlay with fps, frame time, canvas resolution and sim speed (should read about 1.00x; it moves by a couple of percent because steps are whole).

### 5c. Steering Lab and tuning panel

- **Lab mode.** `reset(S, 'lab')` / `S.lab`: the player alone on the track, no rivals, no crates or weapons, no countdown, damage disabled (`hurt()` returns early), and the race never ends (finish and last-car checks are skipped). Start it from the start screen (STEERING LAB) or open the game with `?lab`. `Esc` or EXIT leaves it. The HUD shows last lap, best lap and wall touches (`S.touches`, counted on the rising edge of the player touching a wall).
- **Difficulty levels.** `LEVELS` (`src/levels.js`) is a registry: each level has `assist` (starts on or off), a one-line `blurb`, and a `tune` object with a default for every tunable. **Veteran**: the owner's tuned defaults, assist off (`assistLane` 0.3, `assistSpeed` 1.1). **Rookie**: the same steering values with assist on and both assist sliders at their maximum (`assistLane` 1.5, `assistSpeed` 1.5; measured with the driver study, "maximum help" for corner speed would be the slider minimum, but that makes the car too slow to win, so Rookie uses the slider maximum). The first-run level is Veteran. `?level=rookie|veteran` selects a level for one visit without saving.
- **Panel.** `TUNE_DEFS` (`src/levels.js`) is the list of tunables (key, label, range, hint); the default *values* live in `LEVELS[level].tune`. The panel builds a slider per entry, switches level (ROOKIE/VETERAN), and has RESET (this level's defaults), COPY (JSON of the current values including the level, for baking in) and the ASSIST toggle. It is a side panel in landscape and a top sheet in portrait so the left thumb can keep driving while the right adjusts sliders.
- **Saved tweaks.** Persistence goes through `Profile` (`src/profile.js`: one versioned JSON document under `mm:profile`; do not add other localStorage keys). Damaged saved data is repaired, never trusted: a profile naming level `constructor` or with non-object presets used to throw during startup (permanently, because it was persisted); `tests/unit/levels.test.js` now covers about 25 hostile shapes. Per level it stores only the values the player changed (`presets[level] = { pv, tune: {changed keys}, assist: null | bool }`), so untouched values follow new defaults. **Since M3.1 the presets are per device (`settings.presets`) but the level is per character.** Old pre-profile keys (`mm-tune`, `mm-assist`) are deleted on load.
- **Baking in new defaults.** Paste the COPY output, copy each value into `LEVELS[level].tune` in `src/levels.js` (and `assist`), and **bump `PRESET_VERSION`** so saved tweaks from the old defaults stop hiding the new ones. Check with `?lab` on a profile that has stale saved values.
- **What each tunable does.** `gain` scales the stick; `curve` (>1) makes the centre gentler; `maxLock` caps steering; `speedDamp` reduces steering with speed; `rate` is the smoothing speed; `dead` is the dead zone; `radius` is thumb travel for full deflection (also sizes the stick graphic); `assistLane` scales the assist's lane-hold steering; `assistSpeed` is the corner speed the assist allows, as a multiple of the AI's safe speed. `assistLane` and `assistSpeed` are pushed into `S.tune` every frame and read by `assist()`; the others are shell-only (`readInput()` and `stickMove()`).

## 6. Testing without a browser

Because `Sim` is pure, you can run headless races in plain Node (`package.json` sets `"type": "module"`):

```js
import Sim from './src/sim/sim.js';
const S = Sim.create(1);        // the seed of the session; races are repeatable
Sim.reset(S, 'race', 42);       // or give a race its own seed
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
| `npm run test:sim` | Headless simulation tests (soak, determinism, race config, the pinned rules fingerprint, assist, lab), about 30 s |
| `npm run test:browser` | Real-browser tests: menus, race flow, touch controls, the lab, saved profile, a 9,000-frame soak |
| `npm run study` | The driver study (keyboard-style and thumb-style drivers, with and without assist) |
| `npm run perf` | Main-thread JavaScript cost per frame on a phone-sized screen (real time; noisy) |
| `npm run perf:cpu` | CPU cost per frame in virtual time (about 1% noise); compare before and after a refactor in alternating runs, as `tools/perf-compare.sh` does for the real-time measure |
| `tools/golden-compare.sh <commit>` | **Did a refactor change any pixel?** Renders 21 deterministic scenarios (89 frames: attract mode on three screen shapes, countdown and start, every entity and effect, wrecks, hit flash, shake, reduced motion, the lab, the settings buttons, keyboard and touch controls, the lab panel, all three results screens, the records block, the records screens) from that commit and from the working tree, and compares the exact pixels of the canvas and minimap **and the state of the HUD, overlays, buttons and input values**. About 2 minutes. `npm run golden` runs the capture and compare steps by hand |
| `npm run serve` | Local web server on port 8000 |

**Keyboard shortcuts stand down while the focus is in a text box** (`src/input.js`): typing or pasting a code must not mute the game or start a race; Escape still goes back. Enter or Space on a focused button other than START or RACE AGAIN presses that button.

**Golden harness caveats.** A scenario whose feature the older commit lacks is skipped there (`needs`) and reported as new. Real taps and clicks are followed by a short wait (the browser hands them to the page a moment after the call returns). `GOLDEN_ONLY=name node tools/golden.mjs capture <dir>` captures one scenario, for investigating. **Rarely (about one frame in several hundred per capture) a frame comes out a few antialiased pixels different from an identical run, with the same drawing commands and the same simulation state; the cause was not found** (it is not the random stream, the fonts, audio, the GPU or the camera). A difference like that in a frame the change cannot affect is noise: capture again, and read any difference that repeats.

**Randomness in tests.** Races are seeded (M1.1): the same seed, steps and inputs always give the same race, so a failing test can be replayed exactly. **A loop over races must vary the seed** (`runRace` insists on one), or it runs the same race again and again. Seeds make a test *repeatable*, not *right*: never assert a threshold you have not measured on many seeds (run the scenario 100+ times, look at the distribution, size the sample so a false failure is well under 0.1% per run; two tests written without that discipline failed on CI within an hour). Assert invariants (finite, within limits) rather than outcomes wherever you can. `node tools/driver-study.js 400 <firstSeed>` gives an independent sample of 400 races per row.

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
- **Single track, single mode.** There is no pause, no track select and no difficulty select. Every race is saved, bests are kept, and the results screen and a records screen (RECORDS on the start and results screens) show them; BACKUP on the records screen saves the profile as a code or a file and restores one (M2.4). **There is no way back to the start screen after a race** except reloading the page (RACE AGAIN is the only way on), and Back during a race leaves the game: both predate M2 and are worth a small step of their own.
- **Who is playing is remembered, not asked.** The game opens on the start screen as the last player on that device (`PLAYING AS ADA · CHANGE`); it does not open on "Who's playing?". On a shared tablet, a child who forgets to change plays as, and records for, the last player. Opening the picker first for a household of two or more is a small change in `main.js`.
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
- **The simulation is deterministic and fixed-step.** `Sim.STEP` is the only dt the shell uses (`createStepper` in `src/stepper.js` turns frames into steps). It has two random streams per race, both from the race's seed: `S.rng` for everything that decides the race (AI characters, aim spread, crate contents) and `S.fxRng` for decoration only (sparks, smoke, flames, debris), so dropping or adding particles can never change a race. Use `rand(S, a, b)` / `S.rng()` for gameplay and `frand(S, a, b)` / `S.fxRng()` for decoration; lint bans `Math.random` and `Date` in `src/sim/`. Anything new that is random goes through one of the two streams, and a new gameplay draw changes every race (see `simVersion` in `docs/ROADMAP.md`). `tests/sim/determinism.test.js` checks all of this.
- **The rules are versioned (`Sim.SIM_VERSION`).** A saved race can only be replayed by the sim that played it, so any change to physics, AI, weapons, damage, the track, or the order or number of random draws must bump `SIM_VERSION` in `src/sim/sim.js`. You cannot forget: `tests/sim/simversion.test.js` plays four fixed races and compares hashes with the ones pinned for that version, and its failure message says what to do. Changes outside `src/sim/` (drawing, sound, the interface, the steering feel) are not rules. What is *not* in a config yet: track, laps, rivals, car, loadout (they arrive with their milestones, each as a new config field and a version bump).
- **Lint is part of the build.** `npm run lint` must be clean; CI runs it before the tests. Do not weaken the `src/sim/` rules to make a change compile: pass the data in instead.
- **The results card must fit a landscape phone** (667x375 up to 932x430) without scrolling: the button is the next thing the player needs. On short landscape screens `#end .card` switches to two columns (a media query near the end of the page's CSS); `tests/browser/results.test.js` checks ten screen sizes. Anything added to the card needs the same check.
- Design tokens are CSS variables in `:root`. The look is a dark felt table with chunky toy props, a pop-art red/gold/cyan palette, Bungee for headings and numbers, and Barlow Condensed for UI text.
- DOM is touched only through cached element references and only when a value changes.
- Canvas drawing uses the sim's world coordinates through `proj()`. Nothing in the sim knows about the screen.
- **Cull everything you draw.** `proj()` returns a negative perspective scale for points more than ~900 units behind the camera, and canvas `arc()`/`ellipse()` *throw* on a negative radius. Every object type in `render()` is depth-culled (`-260 < fwd < 1050`) and radii are clamped with `Math.max(0, ...)`. Anything new that can exist far from the player (AI-vs-AI rockets, explosions, mines) must follow the same rule.
- **The main loop must not die.** `frame()` re-arms `requestAnimationFrame` first and runs `tick()` inside try/catch, so one bad frame logs to the console instead of freezing the game forever. If you see `console.error` output during play, that is a real bug to fix, not noise.
- **Test, then deploy, then verify (`.github/workflows/pages.yml`).** Every push to any branch runs the `test` job (`npm run test:ci`, about 2.5 minutes). The `deploy` job `needs` it and runs only on `main`, so a failing test blocks the deploy and branch pushes never try to deploy (the `github-pages` environment accepts `main` only; a branch deploy used to fail, and when the same commit was pushed to `main` and a branch, the branch run cancelled the `main` run, so several builds silently never went live). `tools/stage-site.mjs` builds the folder that is published (only `index.html`, and later `src/` and `fonts/`; never tests, tools or docs) and stamps the commit into `<meta name="build">` and `build.txt`. A last step (`tools/verify-live.sh`) fetches **every published file** from the live site with a cache-buster and fails the run unless each one is byte-identical to what was staged, so a green run means the change is live and complete. Deploys queue rather than cancel each other.
- **Push to `main`; confirm the run.** Work on the branch you are given, then push the same commit to `main` to release. Check the run is green before telling anyone a change is live; if the `test` job is red, nothing was deployed and the live site is still the previous build.
