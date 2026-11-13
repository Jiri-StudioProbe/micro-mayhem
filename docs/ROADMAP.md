# Roadmap and architecture

Read this before starting character creation, car selection, saved scores, aura/shop, accounts or new tracks. None of those are built yet. This note records the vision, the decisions already made, what the code needs, and the order to build in.

## 1. Vision and scope

**In scope**
- Share the game with other people; everyone plays in a browser, on desktop or phone.
- A profile that can be logged into from any device. Everything is saved to it: settings, character, cars, aura, and **every race**.
- Character creation (name, simple design), car selection (three to start), best scores, collectable **aura** to spend on car parts, weapons, ammo, healing packs and eventually better cars, and more tracks.

**Explicitly out of scope for now** (revisit only on purpose; see section 6)
- Public data of any kind: no shared leaderboards, no profiles visible to other players.
- Multiplayer, real-time or asynchronous.
- Real-money purchases.

## 2. What to keep

- **Pure sim.** `Sim` has no DOM, canvas, audio or storage. State goes in (`S.input`), plain events come out (`S.events`). This makes the headless tools (`tools/driver-study.js`, the soak runs) possible and keeps the door open to running the same code on a server. The sim never reads the profile; the shell hands it everything it needs.
- **Data registries.** `WEAP` and `LEVELS` show the pattern: content is a table, code reads the table. Cars, tracks, items and upgrades follow it.
- **`Profile`.** One versioned JSON document with migrations, tolerant of corrupt data. It is the seed of the save system.
- **Measure, then tune.** The driver study showed the mobile problem was assistable wall scraping, not stick gain. Economy and car balance should be settled the same way, headless, before they are tuned by feel.

## 3. Where today's code resists the plan

| Feature | What it needs | What gets in the way now |
|---|---|---|
| More tracks | A track is data: control points, width, laps, theme, crate layout, prop seed | `T`, `N`, `CTRL`, `HALF_W`, `LAPS` are module constants of the Sim, read in about 25 places (`nearest`, `walls`, `aiControl`, `assist`, grid placement, crate layout, `prog >= LAPS * N`). The shell builds props, minimap and wall caches once at load from the single track |
| Car selection | A car is data: top speed, acceleration, turn rate, grip, brakes, hull, size/shape | Stats are hard-coded in `newCar` (372/366, 520, 100 hull) and inside `drive()` (turn 2.75, lateral grip 7.5, brake 640/260, drag). All AI cars share one look (`COLORS[k]`) |
| Upgrades, ammo, healing packs | Stats derived from `base car + owned upgrades`; consumables chosen before the race | Weapon numbers are inline in `tryFire`/`step`, not in `WEAP`. Healing exists only as a crate pickup |
| Character | Name and look as data on the car instance | The player is `NAMES[0] = 'YOU'` and `COLORS[0]`; `drawCar` reads `c.color` only |
| Every race saved | A race record: settings, result, seed, ideally the inputs | `S.result` has the time but nothing persists it. The sim uses `Math.random`, and the loop uses a variable step, so a race cannot be replayed |
| Online profiles | Accounts, sync, a server-side ledger | No backend, no network code, no module system. Google Fonts are loaded from Google |
| All of it | Many screens (home, character, garage, shop, history, track select, results) | Screens are two overlays toggled by `hidden` flags. The shell and sim are one 1,400-line file in two IIFEs |

## 4. Target architecture

Native ES modules, no build step (GitHub Pages serves them as they are):

```
index.html              shell: canvas, #app root, <script type="module">
src/sim/sim.js          pure: reset, step, AI, assist (no DOM, no storage, no network)
src/sim/track.js        buildTrack(def) -> Track
src/data/               plain data: cars.js tracks.js weapons.js levels.js items.js
src/profile.js          schema, migrations, local save, export/import
src/net/                api client, auth, sync queue (the only code that talks to the backend)
src/economy.js          pure: rewards(result), price(item), deriveCar(def, upgrades)
src/render/  audio.js  input.js
src/ui/                 router + screens
tools/                  node tests import src/sim directly
```

Dependencies point one way: `ui -> net, profile, economy, data -> sim`. The sim imports none of them.

Decisions to make before building features:

1. **`RaceConfig` instead of mode strings.** `reset(S, config)` with `{ mode: 'race' | 'lab' | 'attract', track, laps, level, assist, tune, player: { car, livery, name }, rivals, loadout, seed }`. It replaces the `S.lab` / `S.attract` flags and is the single seam between menus and sim. It is also exactly what a saved race stores.
2. **Deterministic sim.** Replace `Math.random` in the sim with a seeded `S.rng`, and run the sim on a fixed 1/60 s step (the loop accumulates time and interpolates for display). Needed so a saved race (config, seed, inputs) can be replayed, so tests are reproducible, and so ghosts or verification are possible later. **Stamp every race with a `simVersion`**: a replay is only valid against the sim that produced it, so any change to physics, AI or weapons bumps it.
3. **Track as an instance, not a global.** `S.track` replaces `T`/`N`/`HALF_W`. `buildTrack(def)` is cached per track id. Track data also carries theme colours, crate layout and prop seed. A validator (the "minimum self-distance" check in `CLAUDE.md` section 6) runs over every track def in CI.
4. **Cars and weapons as data.** `deriveCar(def, upgrades)` is a pure function returning the stats `newCar`, `drive()` and `tryFire` consume. Upgrades only modify numbers, so they are testable without a browser, and AI cars use the same defs.
5. **One profile document plus append-only records.** See section 5.
6. **Screen router.** A small stack (`show('garage')`, `back()`) owning focus, keyboard and the touch layout, replacing the `hidden` toggles. Vanilla is enough; revisit a tiny framework if screens pass about eight.
7. **Tests before deploy.** A GitHub Actions job runs the headless checks (no-NaN soak, track validation, same-seed determinism, profile migrations, economy invariants) plus a browser smoke test (menu, race, results), and the Pages deploy `needs:` it. The deploy must publish the whole `src/` tree, not just `index.html`.
8. **A visible version.** Show `VERSION` on the start screen and in `?debug`. Pages caches aggressively (we have lost time to stale builds), and migrations key off it.

Trade-off to accept: with ES modules, double-clicking `index.html` from disk stops working (browsers block module loading over `file://`). Local use becomes `python3 -m http.server`.

## 5. Online profiles: decisions made

Context: profiles are private, there are no shared leaderboards, no multiplayer and no payments. That changes what must be protected.

**Authorization is the must-have; anti-cheat is not.** There are two separate questions:
- *Who may touch this profile?* Login, plus a server rule that a user can read and write only their own rows. Required from day one.
- *Is what the client reports true?* The race runs on the player's device, so the server only ever receives a claim, and anyone can edit saved data, modify the game or send a hand-made request. With private data the only person a cheater cheats is themselves, so **no anti-cheat now**.

Cheap habits that stay (they protect against our own bugs as much as against cheats):
- **Sanity limits on the server.** A race cannot award more aura than the most a race can give; times below a physical minimum are rejected; values must be well-formed.
- **Every race is saved as its own record**, including `RaceConfig`, `simVersion`, `appVersion`, the result and, once the sim is deterministic, the input log. This costs little and keeps verification possible later.
- **The server owns aura and purchases.** Balance is the sum of an append-only **ledger**; purchases are server-side and check the balance. The client never writes a balance.
- **Client-generated race ids** make uploads idempotent: a retried or double-sent race credits once.

**Accounts.** Guest-first: play immediately on an anonymous profile, and optionally sign in to keep it across devices (email magic link, optionally Google/Apple; no passwords). A guest profile can be claimed by signing in, so nothing is lost.

**What lives where.**
- *Profile document* (settings, driver, selected car, level tweaks): one versioned JSON blob. The client migrates it, so the server schema does not change when the profile grows. Merge rule: last write wins, by `updatedAt`.
- *Races*: an append-only table. Merge rule: union by id.
- *Ledger, purchases, inventory*: server-owned tables; written only by server functions, never by the client.
- *Offline-first.* The game works offline; unsent races wait in a local queue and upload when online. The UI shows a "not yet saved" state rather than failing.

```jsonc
// profile document (client-writable, versioned)
{ "version": 2, "updatedAt": "...",
  "settings": { "level": "veteran", "presets": { "rookie": { "pv": 1, "tune": {}, "assist": null } } },
  "driver":   { "name": "Jiri", "livery": { "body": "#ff5a36", "accent": "#ffd640", "stripe": 1 } },
  "garage":   { "selected": "scout" } }

// race record (append-only; id is generated on the client)
{ "id": "uuid", "ts": "...", "appVersion": "1.9.0", "simVersion": 3,
  "config": { "track": "ridge", "laps": 3, "level": "veteran", "assist": false, "tune": {}, "car": { "id": "scout", "upgrades": [] }, "seed": 123456, "loadout": {} },
  "result": { "kind": "finish", "place": 1, "time": 71.3, "bestLap": 22.8, "kills": 2, "wallTouches": 4 },
  "inputs": "compressed input log (optional until the sim is deterministic)" }

// ledger entry (server-written only)
{ "id": "uuid", "ts": "...", "delta": 40, "reason": "race", "ref": "<race id>" }
```

**Backend.** A managed service, with Supabase as the leading candidate: sign-in, a Postgres database, row-level security (the "own rows only" rule is a one-line policy) and server functions for `commit_race` and `purchase`. The game stays on GitHub Pages. Confirm the choice with a short spike in milestone M3 before committing; Firebase is the alternative. The service's public client key is designed to ship in the page; **any secret key must never enter the repository.**

**Privacy and legal (still required when data is private).** An email address is personal data. Needed before inviting anyone: a short privacy policy and terms, a way to delete the account and its data, and a way to export it. Self-host the fonts (loading them from Google sends visitors' IP addresses to Google). Decide early whether children may play: that changes consent, and the safest design collects no email from them.

**Operations once strangers use it.** Report client errors somewhere you can see them (the freeze we found would otherwise be invisible). Keep a separate staging deployment so a bad build never reaches the live site. Version the API as well as the profile, because old cached pages will keep calling it.

**When these decisions must be revisited.** A shared leaderboard, shared or challenge races, trading between players or real-money purchases make the reported data matter to other people. Then move up to **server-side verification**: the client sends config, seed and inputs, and the server re-runs the sim (the same code, which is why it must stay pure and deterministic) and computes the result itself. Caveat: browsers may compute `sin`/`cos` with tiny differences, so verification should check plausibility within a tolerance rather than expect a bit-exact match.

## 6. Feature notes and open questions

- **Character.** Name (length-limited, shown with `textContent` only, never `innerHTML`) and a livery: body colour, accent, stripe, number. `drawCar` takes a livery. Question: one driver per account, or several?
- **Cars (three).** Define the stat axes first (suggested: top speed, acceleration, handling, hull). Each car needs a distinct silhouette, so car geometry becomes parametric. Question: all three free at the start, or one free and two earned?
- **Best scores.** Best race time and best lap per track and level (and car, if cars differ a lot), tagged with level and assist. Derived from the saved races, so nothing separate to keep in sync.
- **Aura.** Sources: pickups on the track (a new entity list and an `aura` event) plus race rewards (finish, placement, kills, clean laps). Sinks: parts, weapons, ammo, healing packs, cars. Open questions: is aura credited per pickup or at race end, and is any lost when you are wrecked? Healing: a consumable you load out, or regeneration in the race?
- **Tracks.** Authoring is a list of points; a small editor page that previews the track, shows the validator result and exports the point list will pay for itself after the second new track. Per track: laps, AI pacing (`vsafe` is derived), crate density, unlock rule.

## 7. Recommended order

Each milestone ends in a deployable build, green tests and a short "play it" checklist for the owner. Sizes: **S** a session, **M** a few, **L** many.

| # | Milestone | Size | What you can do afterwards |
|---|---|---|---|
| M0 | Solid base | M | Nothing new; the game is the same, but changes are safer |
| M1 | Deterministic races | M | Nothing new; races are repeatable |
| M2 | Every race saved (local) | M | See your race history and personal bests; back up your profile |
| M3 | Accounts and cloud profile | L | **Log in from any device; invite testers** |
| M4 | Character | S | Pick a name and a car design |
| M5 | Cars | M-L | Choose from three cars |
| M6 | Aura | M | Collect aura and see it grow |
| M7 | Shop and upgrades | L | Spend aura on parts, weapons, ammo, healing, cars |
| M8 | More tracks | L | New tracks and a track picker |

**M0. Solid base.** Split into ES modules (mechanical, behaviour-preserving); self-host fonts; add `VERSION`; add the CI job (existing headless tools plus a Playwright smoke test) and make the deploy depend on it; keep a local ring buffer of client errors. *How:* move code without changing it, one module per commit, run the driver study and soak after each. *Done when:* identical behaviour, CI green, the live site shows its version.

**M1. Deterministic races.** Seeded `S.rng`, fixed 1/60 s step with render interpolation, a minimal `RaceConfig`, `simVersion`. *How:* swap `Math.random` call by call; add a test that runs the same seed and inputs twice and compares the result. *Risk:* a fixed step can change handling; compare the driver study and play a lap on a phone before moving on. *Done when:* same seed plus inputs gives an identical race; the driver-study numbers are statistically unchanged.

**M2. Every race saved, locally.** Define the race record; Profile v2 with a migration; save each race to a local history; best time and best lap per track and level on the results screen; a history screen; export/import of the profile as a code string. This is the first real screen, so build the **router** here. *How:* record from the existing `S.result` plus the lab's lap timer; migration tests with old profile shapes. *Done when:* every finished or wrecked race appears in history, records are tagged by level and assist, and an exported profile imports cleanly on another browser.

**M3. Accounts and cloud profile.** Spike and choose the backend; guest-first sign-in; sync of the profile document and race records (offline-first queue); row-level security; delete and export of account data; privacy policy and terms; staging deployment; remote error reporting. *How:* write `src/net/` against a small interface so the provider can change; test with two browser contexts logged into one account, an offline-then-online upload, and a test that user B cannot read user A. *Needs from you:* a backend project (an account you own), a decision on the audience (children or not), and an OK to let the sandbox reach the backend for testing. *Done when:* a profile started on a phone is complete on a laptop, nothing is lost offline, and you have shared it with a few testers. **This is the first milestone worth sharing widely**, and testers' feedback on handling and menus will shape the rest.

**M4. Character.** Name and livery in the profile; `drawCar` takes a livery; the name appears in the HUD and results. *Done when:* the livery shows on the car, the minimap and the results, and syncs across devices.

**M5. Cars.** Three car defs; `deriveCar`; `newCar`, `drive()` and `tryFire` read derived stats; parametric car geometry; garage screen. *How:* balance the cars headless with the driver models so no car dominates, then tune by feel. Saved races record the car. *Done when:* each car drives distinctly, the AI uses the same defs, and driver-study results per car are in the notes.

**M6. Aura.** Aura pickups on the track; reward rules; the server function `commit_race` with limits and the ledger; balance shown on results. *How:* write the economy as pure functions and test invariants (no negative balance, a double-submitted race credits once, caps hold). *Done when:* aura earned in a race appears on every device once, and a bug cannot push a balance negative or absurd.

**M7. Shop and upgrades.** Items as data; server-side `purchase`; parts as stat modifiers through `deriveCar`; weapons and ammo (move weapon numbers into `WEAP`); healing packs and the pre-race loadout; better cars as higher tiers. *How:* simulate earn rate against prices headless before setting prices. *Done when:* a purchase persists, shows on all devices, and can be neither duplicated nor made with too little aura.

**M8. More tracks.** `S.track` refactor; track defs; the validator in CI; the editor/preview page; track select; per-track records (the race record already carries `track`). *Note:* this milestone is independent of M4 to M7 once M0 and M2 exist, so it can move earlier if variety matters more than the economy.

Throughout: run the playtest loop after M3 (share, collect feedback, fix handling first), keep the roadmap and `CLAUDE.md` current, and confirm every deploy succeeded before telling anyone it is live.

## 8. Open questions for the owner

1. **Audience:** friends and family only, or anyone with the link? Could children play? (Affects consent, the sign-in options and how much data we collect.)
2. **Backend:** happy with a managed service (Supabase leading) rather than running a server? An account and project are yours to create.
3. **Sign-in:** email link only, or also Google/Apple?
4. **Cars:** all three free at the start, or one free and two earned?
5. **Aura:** credited per pickup or at race end; lost when wrecked or kept?
6. **Order:** is M8 (tracks) wanted before the economy (M6, M7)?
