# Roadmap and architecture for the next features

Planned, in the order the owner listed them: character creation, car selection (three to start), saved best scores, collectable **aura** (spent on car parts, weapons, ammo, healing packs and eventually better cars), then more tracks. None of these are built yet. This note records what they need from the code, where today's code resists them, and a recommended order. Read it before starting any of them.

## 1. What to keep

- **Pure sim.** `Sim` has no DOM, canvas, audio or storage. State goes in (`S.input`), plain events come out (`S.events`). This is what makes the headless tools (`tools/driver-study.js`, the soak runs) possible. Every feature below must preserve it: the sim never reads the profile, the shell hands it everything it needs.
- **Data registries.** `WEAP`, and now `LEVELS`, show the pattern: content is a table, code reads the table. Cars, tracks, items and upgrades should all follow it.
- **`Profile`** (added with the difficulty levels): one versioned JSON document in `localStorage`. It is the seed of the save system below.

## 2. Where today's code resists the plan

| Feature | What it needs | What gets in the way now |
|---|---|---|
| More tracks | A track is data: control points, width, laps, theme, crate layout, prop seed | `T`, `N`, `CTRL`, `HALF_W`, `LAPS` are module constants of the Sim, read in about 25 places (`nearest`, `walls`, `aiControl`, `assist`, grid placement, crate layout, `prog >= LAPS * N`). The shell also builds props, minimap and wall caches once at load from the single track |
| Car selection | A car is data: top speed, acceleration, turn rate, grip, brakes, hull, size/shape | Stats are hard-coded in `newCar` (372/366, 520, 100 hull) and inside `drive()` (turn 2.75, lateral grip 7.5, brake 640/260, drag). All AI cars share one look (`COLORS[k]`) |
| Upgrades, ammo, healing packs | Stats derived from `base car + owned upgrades`; consumables chosen before the race | Weapon numbers (cooldown, damage, radius, ammo) are inline in `tryFire`/`step`, not in `WEAP`. Healing exists only as a crate pickup |
| Character creation | Name and look as data on the car instance | The player is `NAMES[0] = 'YOU'` and `COLORS[0]`; `drawCar` reads `c.color` only |
| Best scores | Records keyed by track, level and (maybe) car; saved at race end | `S.result` has the time but nothing persists it. The lab already computes lap times in the shell |
| Aura | A collectible entity, an event, a wallet, race rewards | No collectible except crates; nothing carries value between races |
| All of it | Many screens (home, character, garage, shop, track select, results) | Screens are two overlays toggled by `hidden` flags and `overlayOpen()`. The shell and sim are one 1,300-line file in two IIFEs |

## 3. Target architecture

Native ES modules, no build step (GitHub Pages serves them as they are):

```
index.html              shell: canvas, #app root, <script type="module">
src/sim/sim.js          pure: reset, step, AI, assist (no DOM, no storage)
src/sim/track.js        buildTrack(def) -> Track
src/data/               plain data: cars.js tracks.js weapons.js levels.js items.js
src/profile.js          schema, migrations, export/import
src/economy.js          pure: rewards(result), price(item), purchase(profile, item), deriveCar(def, upgrades)
src/render/  audio.js  input.js
src/ui/                 router + screens
tools/                  node tests import src/sim directly
```

Dependencies point one way: `ui -> profile, economy, data -> sim`. The sim imports from none of them.

Decisions to make before building features:

1. **`RaceConfig` instead of mode strings.** `reset(S, config)` with `{ mode: 'race' | 'lab' | 'attract', track, laps, level, player: { stats, livery, name }, rivals, loadout, seed }`. This replaces the `S.lab` / `S.attract` flags and is the single seam between menus and sim.
2. **Track as an instance, not a global.** `S.track` replaces `T`/`N`/`HALF_W`. `buildTrack(def)` is cached per track id. Track data also carries theme colours, crate layout and prop seed. A track validator (the "minimum self-distance" check in `CLAUDE.md` section 6) runs over every track def automatically.
3. **Cars and weapons as data.** `deriveCar(def, upgrades)` is a pure function returning the stats `newCar`, `drive()` and `tryFire` consume. Upgrades only modify numbers, so they are testable without a browser, and AI cars use the same defs.
4. **Seeded RNG in the sim.** The sim calls `Math.random` for AI skill, crate drops and spread. Replace with `S.rng` (a seeded generator such as the `rng()` already used for props). Gives reproducible tests, makes ghost cars and replays possible later, and lets a saved best time be re-checked.
5. **One profile document, migrated by version.** See section 4. All persistence goes through `Profile`; no ad-hoc `localStorage` keys.
6. **Screen router.** A small stack (`show('garage')`, `back()`) owning focus, keyboard and the touch layout, replacing the `hidden` toggles. Vanilla is enough; revisit a tiny framework (e.g. Preact via ESM) if screens pass about eight.
7. **Tests before deploy.** A GitHub Actions job runs the headless checks (no NaN soak, track validation, determinism for a seed, economy invariants, profile migrations) and the Pages deploy `needs:` it. The deploy step must publish the whole `src/` tree, not just `index.html` as it does today.
8. **A visible version.** Show a `VERSION` string on the start screen and in `?debug`. Pages caches aggressively (we have already lost time to stale builds), and profile migrations key off the version.

Trade-off to accept: with ES modules, double-clicking `index.html` from disk stops working (browsers block module loading over `file://`). Local use becomes `python3 -m http.server`. Worth it once there are more than a few files; not before.

## 4. Profile sketch

```jsonc
{
  "version": 1,
  "settings": { "level": "veteran", "presets": { "rookie": { "pv": 1, "tune": {}, "assist": null } } },   // exists today
  "driver":   { "name": "Jiri", "livery": { "body": "#ff5a36", "accent": "#ffd640", "stripe": 1 } },
  "garage":   { "selected": "scout", "owned": { "scout": { "upgrades": ["engine1"] } } },
  "wallet":   { "aura": 120 },
  "inventory":{ "ammo": { "rocket": 4 }, "healPacks": 1 },
  "records":  { "ridge": { "veteran": { "race": 71.3, "lap": 22.8 } } }
}
```

- **Save at race end, atomically.** `commitRace(profile, result)` applies rewards, records and consumed items in one step, then saves once. A tab closed mid-race never half-applies.
- **Local only for now.** `localStorage` is per browser and can be cleared, so add **export/import** (copy-paste a code string) early. Because the profile is plain JSON, a hosted save (needs a backend, since Pages is static) can be added later without reshaping it.
- **Records are tagged** with level (and whether assist was on), so a Rookie time is not compared with a Veteran one.
- **Bad data never crashes.** Loading already tolerates corrupt JSON and unknown fields; migrations go oldest-first in `Profile`.
- **Baking in defaults.** `PRESET_VERSION` discards saved tweaks when new level defaults ship. The same idea applies to any future shipped defaults that players can override.

## 5. Feature notes and open questions

- **Character creation.** Name (length-limited, shown with `textContent` only, never `innerHTML`) and a livery: body colour, accent, stripe, number. Needs `drawCar` to take a livery. Question: one driver per device, or several?
- **Car selection (three).** Define the stat axes first (suggested: top speed, acceleration, handling, hull). Each car needs a distinct silhouette, so car geometry should be parametric rather than a copy of `drawCar`. Question: all three free at the start, or one free and two earned?
- **Best scores.** Decide what counts: best race time and best lap per track and level, maybe kills. Show them on the results screen and track select. The lab's lap timer already exists.
- **Aura.** Sources: pickups on the track (a new entity list and an `aura` event) plus race rewards (finish, placement, kills, clean laps). Sinks: parts, weapons, ammo, healing packs, cars. The economy should be simulated headless with the driver models (as `tools/driver-study.js` does for steering) to tune earn rates against prices. Open questions: is aura banked per pickup or at race end, and is any lost when you are wrecked? Healing: consumable you load out, or regeneration in the race?
- **More tracks.** Authoring is a list of points; a small editor page that previews the track, shows the validator result and exports the point list would pay for itself after the second new track. Per track: laps, AI pacing (`vsafe` is derived, so mostly free), crate density, unlock rule.

## 6. Recommended order

0. **Foundation, no gameplay change:** ES module split, `RaceConfig`, `S.track`, seeded RNG, the CI job, `VERSION`. Prove it with the existing tools: same seed gives the same race, driver-study results stay as they are.
1. **Profile v1 and best scores.** The smallest vertical slice; exercises profile, results and the router.
2. **Car data, car selection, livery rendering.** `drive()` and `tryFire` read derived stats.
3. **Character creation.** Mostly the livery plumbing from step 2 plus a name field; can be merged into step 2.
4. **Aura, rewards, shop, upgrades and consumables.**
5. **More tracks.** Step 0 does the hard refactor, so this can move earlier if tracks matter more than the economy.

Steps 0 and 1 are the ones that decide whether the later ones are cheap or painful; everything after them is mostly data plus screens.
