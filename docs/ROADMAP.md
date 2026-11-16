# Roadmap and architecture

Read this before starting character creation, car selection, saved scores, aura/shop, accounts or new tracks. None of those are built yet. This note records the vision, the decisions already made, what the code needs, and the order to build in.

## 1. Vision and scope

**In scope**
- Share the game with other people; everyone plays in a browser, on desktop or phone.
- A **household** (the account) that can be signed in to from any device, holding several **characters** (family members), Switch-style. Everything a character does is saved to it: character, cars, aura, and **every race**. The characters of one household see a **family leaderboard**; other households see nothing of it (section 5b).
- Character creation (name, simple design), car selection (three to start), best scores, collectable **aura** to spend on car parts, weapons, ammo, healing packs and eventually better cars, and more tracks.

**Explicitly out of scope for now** (revisit only on purpose; see section 6)
- Anything visible **across households**: no global or public leaderboards, no profiles visible to people outside your household. (A leaderboard *inside* a household is in scope.)
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

Context: data is private to a household, there are no cross-household leaderboards, no multiplayer and no payments. That changes what must be protected. (The household model is section 5b; privacy and GDPR are section 5c; where they differ from this section, 5b and 5c win.)

**Authorization is the must-have; anti-cheat is not.** There are two separate questions:
- *Who may touch this profile?* Login, plus a server rule that a user can read and write only their own rows. Required from day one.
- *Is what the client reports true?* The race runs on the player's device, so the server only ever receives a claim, and anyone can edit saved data, modify the game or send a hand-made request. With private data the only person a cheater cheats is themselves, so **no anti-cheat now**.

Cheap habits that stay (they protect against our own bugs as much as against cheats):
- **Sanity limits on the server.** A race cannot award more aura than the most a race can give; times below a physical minimum are rejected; values must be well-formed.
- **Every race is saved as its own record**, including `RaceConfig`, `simVersion`, `appVersion`, the result and, once the sim is deterministic, the input log. This costs little and keeps verification possible later.
- **The server owns aura and purchases.** Balance is the sum of an append-only **ledger**; purchases are server-side and check the balance. The client never writes a balance.
- **Client-generated race ids** make uploads idempotent: a retried or double-sent race credits once.

**Accounts.** Guest-first: play immediately on a local household, and optionally sign in to keep it across devices (an emailed 6-digit code; no passwords, no Google or Apple). A guest household can be claimed by signing in, so nothing is lost.

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

## 5b. Households and characters: decisions made

```
Household (the account: one email login)
 ├─ Character "Jiri"   → races, bests, (later) aura, cars, upgrades
 ├─ Character "Anna"   → …
 └─ Character "Tom"    → …
Family leaderboard = the characters of one household, ranked on their races
```

- **The household is the account.** Only an adult holds an email. A character has no login, only a nickname, so nothing personal is collected from children.
- **A character owns the progress** (races, bests, aura, cars, upgrades), so M6 and M7 stay per-character with no redesign.
- **Characters are chosen on a "Who's playing?" screen** on any device signed in to the household; the last one used on a device is remembered.
- **Anyone signed in to the household may play and edit any character.** No PIN between family members for now (an optional per-character PIN can come later).
- **The family leaderboard is derived, not stored**: each character's best per board (track, level, assist) computed from the household's races. Boards stay separate by level and assist, as personal bests are today.
- **Sign-in: an emailed 6-digit code**, typed into the page (email links often open in a different browser from the game on phones). No passwords. Google and Apple sign-in are not planned. Later option: a pairing code from a signed-in device, so a child's tablet needs no email. The schema supports both.
- **Several adults per household** (a partner, a grandparent): the schema holds a list of members from day one; the invite screen is not part of M3.
- **Settings split.** *Per device*: mute, steering tuning and the lab presets (a phone and a desktop feel different). *Per character*: name, difficulty level (so a child can stay on Rookie), races and bests.
- **Today's local profile becomes the first character** on first run (you name it), so no race is lost.
- **Server rule:** a user may read and write a row only if they belong to its household. Another household's rows are invisible. A cross-household feature would be a new, explicit sharing rule, not a change to this one.
- **Merge rules:** the household and character documents are last-write-wins by `updatedAt`; races are a union by id; deleting a character or household syncs as a deletion (a tombstone), so other devices purge their copies.
- **Guest-first stays.** A household that exists only on one device, with no account, works fully offline (the family leaderboard included). Signing in later *claims* it into an account.

Sketch of the model (the server shape; the local cache mirrors it):

```jsonc
household:  { "id", "createdAt", "updatedAt", "deletedAt?" }
member:     { "householdId", "userId", "role": "owner" | "adult" }       // userId = the auth account
character:  { "id", "householdId", "name", "updatedAt", "deletedAt?", "settings": { "level" } }   // livery etc. later
race:       { "id", "characterId", "householdId", …existing record… }  // householdId copied in, so the access rule is one check
```

## 5c. Privacy and GDPR

**Honest framing.** GDPR applies to anyone who offers a service to people in the EU, wherever the owner lives, so we treat it as applying. "100% compliant" is not something code can certify: it is a mix of **technical design** (which we build and test) and **organisational duties** (which the owner holds). Before anyone outside the family is invited, **a lawyer or data-protection adviser reviews the result**; this section is the engineering checklist for that review, not legal advice.

**Roles.** The owner is the *controller*. The backend provider (and the email-sending service) are *processors*: a signed data-processing agreement with each, a list of them in the privacy notice, and the backend project created in an **EU region**. Static hosting (GitHub Pages) sees visitors' IP addresses; the notice says so.

**Data we hold, and why.** Adult's email (to sign in); character nicknames and settings; race records (times, level, assist, seed). *Legal basis:* performing the service the adult asked for (Art. 6(1)(b)); a minimal security and error log under legitimate interest. No consent is needed for what we collect, provided we stay inside this list. Anything new (analytics, advertising, extra profile fields) needs a decision first.

**Designed in (testable).**
- **Minimisation.** No child email, age, birthday, photo or free text beyond a nickname. The sign-in screen and character screen tell users to use a nickname, not a real name.
- **No third parties in the page.** Fonts are self-hosted, tests already block every non-local request, and there is no analytics, so no cookie banner is needed: browser storage holds only what the game needs to work and keep you signed in.
- **Remote error reports carry no personal data**: message, stack, app and sim version only. Never names, emails or race data; a test checks the scrubbing.
- **Access control by row** (section 5b), tested: a user in household B cannot read household A. No secret key ever enters the repository.
- **Transparency.** A plain-language privacy notice and a short child-friendly version, linked from the sign-in screen and the start screen; terms stating that the account holder is an adult who manages the players.
- **Children.** The adult creates and controls every character; a character holds only a nickname. Whether the adult's agreement alone covers children's data under each country's rules (the age of digital consent is 13 to 16 depending on the member state) is a **question for the adviser**, not something we assume.
- **Records.** A short record of processing and a breach procedure in `docs/`, kept up to date.

**Rights, as features (M3.5).**
- *Access and portability:* export the whole household as machine-readable JSON (the backup code already does this for one device).
- *Rectification:* rename a character; change the email.
- *Erasure:* delete a character (its races go with it) and delete the household (every row, the sign-in account, and local copies on the device; other devices purge at their next sync). The notice states how long provider backups keep deleted data.
- *Restriction and objection, questions, complaints:* a privacy contact address in the notice; requests answered within one month.

**Storage limitation.** Race history is kept while the household exists. A household inactive for **24 months** gets an email warning and is then deleted (to confirm with the adviser).

**Security.** TLS everywhere; rate limits on sign-in codes; least-privilege keys (the public client key ships in the page, any service key stays on the provider); dependency updates; the **72-hour breach notice** duty written into the breach procedure.

**Open items for the owner and the adviser.** Whether a representative in the EU is required for a non-EU controller (there are exemptions for occasional, low-risk processing; children's data may weigh against them); whether a data-protection impact assessment is needed (children, new service); the retention period; the consent route for children in each country you share in.

## 6. Feature notes and open questions

- **Character.** Name (length-limited, shown with `textContent` only, never `innerHTML`) and a livery: body colour, accent, stripe, number. `drawCar` takes a livery. **Decided: several characters per household** (section 5b); the name part arrives in M3.1, the livery stays in M4.
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
| M3 | Households, characters and cloud sync | L | **Family members share an account, each with a character and a family leaderboard; log in from any device; invite testers** |
| M4 | Character | S | Pick a name and a car design |
| M5 | Cars | M-L | Choose from three cars |
| M6 | Aura | M | Collect aura and see it grow |
| M7 | Shop and upgrades | L | Spend aura on parts, weapons, ammo, healing, cars |
| M8 | More tracks | L | New tracks and a track picker |

**Progress.** M0.1 (test safety net), M0.2 (test, deploy, verify pipeline), M0.3 (self-hosted fonts, which also closes the Google Fonts privacy item in section 5) M0.4 (simulation moved to `src/sim/sim.js` verbatim, ESLint with the purity rules) M0.5 (shell moved to `src/main.js` verbatim; version, diagnostics, profile, levels and audio extracted into tested modules) M0.6 (renderer moved to `src/render/`, pixel-identical) and M0.7 (input, HUD and screens, steering lab, race flow, camera and the frame loop moved out of `src/main.js` into `src/input.js`, `src/game.js`, `src/camera.js`, `src/loop.js` and `src/ui/`; `main.js` is now only wiring; every pixel and every HUD, overlay, button and input state identical, no import cycles) are done; see `docs/M0-baseline.md` for the numbers later steps must reproduce. M0.8 (the start screen shows the version and the deployed commit; README and CLAUDE.md brought up to date) is done, which **completes M0**. M1.1 (seeded races: `S.rng` and `S.fxRng` from `src/sim/rng.js`, `create(seed)` / `reset(S, mode, seed)`, `Math.random` banned in the sim by lint, determinism tests; the driver study is statistically unchanged over 5 batches of 400 races) is done. M1.2 (fixed 1/60 s step: `src/stepper.js`, render interpolation in `src/interp.js`, input read once per step; the simulation itself unchanged) is done. M1.3 (`RaceConfig`: `reset(S, config)` with `makeConfig` / `configProblems` / `raceHeader`, `S.config` recording the seed actually used, `Sim.SIM_VERSION` with a pinned fingerprint test; pixel- and driver-study-identical to M1.2) is done, which **completes M1**: a race is now a function of its config, seed and inputs. M2.1 (every race that ends is saved: Profile v2 with a migration, `src/records.js`, lap times and wall touches in the sim's result; no visible change yet) is done. **M2 is being built in four steps** (all four are done: **M2 is complete**): M2.1 the data (done); M2.2 the results screen shows your time and best lap against your bests, with NEW BEST (done); M2.3 the screen router and a history screen (done); M2.4 export and import of the profile as a code string (done: BACKUP on the records screen; a code or a file; ADD TO THIS DEVICE merges, REPLACE EVERYTHING replaces after a second tap). **Decision taken in M2.1: the input log is not recorded yet.** It is not needed for any of M2's goals, it is by far the biggest part of a race's data, and a record without it is still complete as a *result*; it is needed for replays, ghosts and server-side verification, so it comes with the first of those. Two things that work will have to handle: the log must include assist toggles (the HUD button changes `S.assist` mid-race, which is an input; M2.1 already flags such races with `result.assistChanged` and gives them no best) and the shell's per-step push of the assist tuning (`readInput`), which only varies in the lab.

**M0. Solid base.** Split into ES modules (mechanical, behaviour-preserving); self-host fonts; add `VERSION`; add the CI job (existing headless tools plus a Playwright smoke test) and make the deploy depend on it; keep a local ring buffer of client errors. *How:* move code without changing it, one module per commit, run the driver study and soak after each. *Done when:* identical behaviour, CI green, the live site shows its version.

**M1. Deterministic races.** Seeded `S.rng`, fixed 1/60 s step with render interpolation, a minimal `RaceConfig`, `simVersion`. *How:* swap `Math.random` call by call; add a test that runs the same seed and inputs twice and compares the result. *Risk:* a fixed step can change handling; compare the driver study and play a lap on a phone before moving on. *Done when:* same seed plus inputs gives an identical race; the driver-study numbers are statistically unchanged.

*Sub-steps.* **M1.1** seeded RNG (done); **M1.2** fixed 1/60 s step with render interpolation (done; the sim then no longer depends on how long frames take, which is the other half of repeatability; this one can change handling, so it gets the driver study and a phone lap); **M1.3** `RaceConfig` and `simVersion` (done; `S.lab` and `S.attract` stayed as conveniences derived from `config.mode`, and the config holds only what exists today: mode, seed, assist, assist tuning; track, laps, rivals, car and loadout are added by their milestones).

**M2. Every race saved, locally.** Define the race record; Profile v2 with a migration; save each race to a local history; best time and best lap per track and level on the results screen; a history screen; export/import of the profile as a code string. This is the first real screen, so build the **router** here. *How:* record from the existing `S.result` plus the lab's lap timer; migration tests with old profile shapes. *Done when:* every finished or wrecked race appears in history, records are tagged by level and assist, and an exported profile imports cleanly on another browser.

**M3. Households, characters and cloud sync.** Built in five steps, each ending in a deployable build. The household and character model (sections 5b and 5c) is built and tested locally **before** any backend exists.

- **M3.1 Households and characters, local only.** Profile v3 with a migration (the existing profile becomes the first character; settings split into per-device and per-character); a "Who's playing?" screen (create, rename, delete a character, nickname guidance); races carry `characterId`; the **family leaderboard** screen built from the saved races. *Done when:* two characters on one browser have separate histories and bests and appear on a family leaderboard, and an old profile migrates without losing a race. No server, no network.
- **M3.2 Sync layer against a fake backend.** `src/net/` behind a small interface (provider-neutral); the offline queue, the merge rules of section 5b and tombstones; a "not yet saved" state in the UI. *Done when:* tests with two simulated devices converge after offline edits, retries credit nothing twice, and a deletion purges the other device.
- **M3.3 Backend spike, schema and access rules.** Confirm the provider (Supabase is the leading candidate; Firebase the alternative) with a short spike; create the project in an **EU region**; tables for households, members, characters and races; row-level rules; a test that user B cannot read or write household A. *Needs from you:* an account and project you own, the sandbox allowed to reach it, and the signed data-processing agreement. Secrets never enter the repository.
- **M3.4 Sign-in and sync.** Emailed 6-digit code sign-in; "claim this device's household" into an account; a real provider adapter behind the M3.2 interface; sign out clears local data on request. *Done when:* a household started on a phone is complete on a laptop (a two-browser-context test), and nothing is lost offline.
- **M3.5 Privacy, rights and operations.** Privacy notice (plain and child-friendly) and terms; export the household as JSON; delete a character and delete the household (every row, the sign-in account, local copies); the inactivity rule; remote error reporting with scrubbing; a staging deployment; records of processing and the breach procedure in `docs/`. **Gate: nobody outside your family is invited until the adviser has reviewed this.** *Done when:* your family plays on several devices and the privacy checklist in section 5c is green.

*How:* write the sync code against the interface so the provider can change; test with fakes first, then two real browser contexts. **This is the first milestone worth sharing, and testers' feedback on handling and menus will shape the rest.**

**M4. Character.** Name and livery in the profile; `drawCar` takes a livery; the name appears in the HUD and results. *Done when:* the livery shows on the car, the minimap and the results, and syncs across devices.

**M5. Cars.** Three car defs; `deriveCar`; `newCar`, `drive()` and `tryFire` read derived stats; parametric car geometry; garage screen. *How:* balance the cars headless with the driver models so no car dominates, then tune by feel. Saved races record the car. *Done when:* each car drives distinctly, the AI uses the same defs, and driver-study results per car are in the notes.

**M6. Aura.** Aura pickups on the track; reward rules; the server function `commit_race` with limits and the ledger; balance shown on results. *How:* write the economy as pure functions and test invariants (no negative balance, a double-submitted race credits once, caps hold). *Done when:* aura earned in a race appears on every device once, and a bug cannot push a balance negative or absurd.

**M7. Shop and upgrades.** Items as data; server-side `purchase`; parts as stat modifiers through `deriveCar`; weapons and ammo (move weapon numbers into `WEAP`); healing packs and the pre-race loadout; better cars as higher tiers. *How:* simulate earn rate against prices headless before setting prices. *Done when:* a purchase persists, shows on all devices, and can be neither duplicated nor made with too little aura.

**M8. More tracks.** `S.track` refactor; track defs; the validator in CI; the editor/preview page; track select; per-track records (the race record already carries `track`). *Note:* this milestone is independent of M4 to M7 once M0 and M2 exist, so it can move earlier if variety matters more than the economy.

Throughout: run the playtest loop after M3 (share, collect feedback, fix handling first), keep the roadmap and `CLAUDE.md` current, and confirm every deploy succeeded before telling anyone it is live.

## 8. Open questions for the owner

**Decided**
1. **Audience:** family first, then friends, some of them in the EU, so GDPR applies (section 5c). Children may play, through an adult's household.
2. **Sign-in:** emailed 6-digit code only. No Google or Apple.
3. **Household model:** section 5b (several characters; free switching; one email login to start; level and presets as described there).

**Still open**
4. **Backend:** a managed service (Supabase leading) rather than running a server; confirmed at the M3.3 spike. An account and project are yours to create.
5. **Privacy adviser:** who reviews M3.5 before outside invitations, plus the open items listed at the end of section 5c.
6. **Cars:** all three free at the start, or one free and two earned?
7. **Aura:** credited per pickup or at race end; lost when wrecked or kept?
8. **Order:** is M8 (tracks) wanted before the economy (M6, M7)?
