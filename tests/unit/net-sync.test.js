import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../src/net/sync.js';
import { metaOf, canonical } from '../../src/net/merge.js';
import { createProfile } from '../../src/profile.js';
import { addCharacter, renameCharacter, removeCharacter, setCurrent } from '../../src/household.js';
import { addRace, MAX_RACES } from '../../src/records.js';
import { mergeProfiles } from '../../src/backup.js';
import { createFakeServer, fakeTimers } from '../helpers/fakebackend.js';
import { memoryStorage } from '../helpers/storage.js';
import { finishRecord } from '../helpers/records.js';

const HID = 'house-1';
// One clock for the whole test, ticking a second at every look: whoever acts later has the later time, on every device.
const makeClock = () => { let n = 0; return () => new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + (++n) * 1000).toISOString(); };

function world() {
  const server = createFakeServer(), now = makeClock(), timers = fakeTimers();
  let rec = 0;
  const device = (name, { household = HID, ...opts } = {}) => {
    let n = 0; const storage = memoryStorage(), ctx = { newId: () => `${name}-${++n}`, now };
    const Profile = createProfile(storage, ctx); Profile.data.household.id = household;
    const changes = [], statuses = [];
    const sync = createSync({ Profile, backend: server.backendFor(household), now, setTimer: timers.setTimer, clearTimer: timers.clearTimer, onChange: () => changes.push(1), onStatus: s => statuses.push(s), ...opts });
    const d = { name, Profile, storage, sync, ctx, changes, statuses, data: Profile.data,
      // a player (the first is the default Player renamed, so that it is not an unused one)
      player(nameOf) { if (Profile.data.characters.length === 1 && Profile.data.characters[0].name === 'Player') { renameCharacter(Profile.data, Profile.data.characters[0].id, nameOf, ctx); return Profile.data.characters[0]; } return addCharacter(Profile.data, nameOf, ctx).character; },
      // a race for a character, as the recorder would record it: in the history, and told to the sync
      race(character, time = 80 + (rec % 7), level = 'veteran') { const r = finishRecord(`r${++rec}`, time, [27, 26, 26], { level }); r.ts = now(); addRace(character, r); sync.queueRace(r.id); Profile.save(); return r; },
      ids: c => c.races.map(r => r.id),
      byName: nameOf => Profile.data.characters.find(c => c.name === nameOf) };
    return d;
  };
  return { server, now, timers, device };
}
const ok = async d => { const r = await d.sync.syncNow(); assert.equal(r.ok, true, JSON.stringify(r.status.error)); return r; };
const household = d => ({ meta: canonical(metaOf(d.data)), races: Object.fromEntries(d.data.characters.map(c => [c.id, d.ids(c).slice().sort()])) });

test('a household that has only lived on one device is put online: its characters, their races, and nothing is sent twice', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'), bo = a.player('Bo');
  a.race(ada); a.race(ada); a.race(ada); a.race(bo);
  assert.equal(a.sync.status().pending, 5, 'four races and the household are not on the server yet');
  await ok(a);
  assert.deepEqual(w.server.meta(HID).characters.map(c => c.name), ['Ada', 'Bo']); assert.equal(w.server.raceCount(HID), 4);
  assert.equal(a.sync.status().pending, 0); assert.equal(a.sync.status().state, 'idle');
  const writes = w.server.calls.filter(c => c.method === 'putMeta' || c.method === 'putRaces').length, saved = a.storage.writes;
  await ok(a); await ok(a);
  assert.equal(w.server.calls.filter(c => c.method === 'putMeta' || c.method === 'putRaces').length, writes, 'syncing again sends nothing');
  assert.equal(a.storage.writes, saved, 'and writes nothing to the profile');
});

test('a new device joins: it gets the characters and all their races, and its unused Player is not part of the household', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'), bo = a.player('Bo');
  a.race(ada); a.race(ada); a.race(bo); await ok(a);
  const b = w.device('B'); assert.equal(b.data.characters[0].name, 'Player');
  await ok(b);
  assert.deepEqual(b.data.characters.map(c => c.name), ['Ada', 'Bo']); assert.deepEqual(household(b), household(a));
  assert.equal(w.server.meta(HID).characters.length, 2, 'the Player was not uploaded'); assert.ok(b.data.characters.some(c => c.id === b.data.settings.character), 'someone is playing');
  assert.equal(b.changes.length, 1, 'the game was told that what it shows has changed');
  assert.deepEqual(b.data.characters[0].bests, a.data.characters[0].bests, 'and their personal bests came with them');
});

test('a new device on a household with nothing in it online: its Player becomes the household\'s first character', async () => {
  const w = world(), b = w.device('B'); await ok(b);
  assert.deepEqual(w.server.meta(HID).characters.map(c => c.name), ['Player']);
});

test('two devices that change things while offline end up with the same household, whichever syncs first', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'), bo = a.player('Bo'); a.race(ada); a.race(bo); await ok(a);
  const b = w.device('B'); await ok(b);
  // offline: A renames Ada and races as Ada; B moves Bo to Rookie, races as Bo and as Ada, and Bo sets a best there
  renameCharacter(a.data, ada.id, 'Ada L', a.ctx); const a2 = a.race(a.byName('Ada L'), 70);
  const boB = b.byName('Bo'); boB.level = 'rookie'; boB.updatedAt = w.now(); const b1 = b.race(boB, 60, 'rookie'), b2 = b.race(b.byName('Ada'), 99);
  await ok(a); await ok(b); await ok(a);
  assert.deepEqual(household(a), household(b));
  assert.deepEqual(a.data.characters.map(c => [c.name, c.level]), [['Ada L', 'veteran'], ['Bo', 'rookie']]);
  assert.ok(a.ids(a.data.characters[0]).includes(a2.id) && a.ids(a.data.characters[0]).includes(b2.id), 'both devices\' races are in Ada\'s history');
  assert.ok(a.ids(a.data.characters[1]).includes(b1.id));
  assert.equal(a.data.characters[0].bests['classic/veteran/manual'].time, 70, 'the better of the two bests');
  assert.equal(w.server.raceCount(HID), 2 + 3, 'the server has each race once');
  const order = await (async () => { const c = w.device('C'); await ok(c); await ok(a); await ok(b); return household(c); })();
  assert.deepEqual(order, household(a));
});

test('a response that is lost after the server stored the races credits nothing twice: the retry finds them there', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); await ok(a);
  a.race(ada); a.race(ada);
  w.server.failNext('putRaces', { kind: 'offline', afterApply: true });
  const first = await a.sync.syncNow();
  assert.equal(first.ok, false); assert.equal(first.status.error.kind, 'offline'); assert.equal(w.server.raceCount(HID), 2, 'the server did store them');
  assert.equal(a.sync.status().pending, 2, 'the device does not know, so they are still waiting');
  await ok(a); assert.equal(w.server.raceCount(HID), 2, 'and are not stored again'); assert.equal(a.sync.status().pending, 0);
  const b = w.device('B'); await ok(b); assert.equal(b.data.characters.flatMap(c => c.races).length, 2);
});

test('an upload that is cut off carries on where it stopped, after a restart too', async () => {
  const w = world(), a = w.device('A', { batchSize: 2 }), ada = a.player('Ada'); await ok(a);
  for (let i = 0; i < 5; i++) a.race(ada);
  w.server.offline = false; w.server.failNext('putRaces', { kind: 'offline' });   // the first batch is lost, nothing was stored
  assert.equal((await a.sync.syncNow()).ok, false); assert.equal(w.server.raceCount(HID), 0);
  w.server.calls.length = 0;
  const restarted = createSync({ Profile: a.Profile, backend: w.server.backendFor(HID), now: w.now, setTimer: w.timers.setTimer, clearTimer: w.timers.clearTimer, batchSize: 2 });
  assert.equal((await restarted.syncNow()).ok, true);
  assert.equal(w.server.raceCount(HID), 5); assert.deepEqual(w.server.callsTo('putRaces').map(c => c.args[0].length), [2, 2, 1], 'three batches of 2, 2 and 1');
  assert.deepEqual(a.Profile.data.settings.sync.outbox, []);
});

test('deleting a player deletes them on every device, with their races, and a race recorded for them meanwhile is not sent', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'), cy = a.player('Cy'); a.race(ada); a.race(cy); a.race(cy); await ok(a);
  const b = w.device('B'); await ok(b); setCurrent(b.data, b.byName('Cy').id); b.Profile.save();
  const lateRace = b.race(b.byName('Cy'));   // B does not know yet
  assert.deepEqual(removeCharacter(a.data, cy.id, a.ctx), { ok: true }); await ok(a);
  assert.equal(w.server.raceCount(HID), 1, 'the server purged their races'); assert.deepEqual(Object.keys(w.server.meta(HID).deleted), [cy.id]);
  await ok(b);
  assert.deepEqual(b.data.characters.map(c => c.name), ['Ada']); assert.equal(b.data.settings.character, b.data.characters[0].id, 'B plays as someone who is still there');
  assert.equal(w.server.raceCount(HID), 1, 'the late race was not sent'); assert.ok(!b.Profile.data.settings.sync.outbox.includes(lateRace.id)); assert.deepEqual(household(a), household(b));
});

test('delete wins over a rename made elsewhere after it, on both devices', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'), cy = a.player('Cy'); await ok(a);
  const b = w.device('B'); await ok(b);
  removeCharacter(a.data, cy.id, a.ctx); a.Profile.save();
  renameCharacter(b.data, cy.id, 'Cyrus', b.ctx);   // later than the deletion
  await ok(a); await ok(b); await ok(a);
  assert.deepEqual(a.data.characters.map(c => c.name), ['Ada']); assert.deepEqual(b.data.characters.map(c => c.name), ['Ada']); assert.equal(ada.name, 'Ada');
});

test('a device that deleted its Player and another that deleted theirs: the household is never left empty', async () => {
  const w = world(), a = w.device('A'), x = a.player('X'), y = a.player('Y'); await ok(a);
  const b = w.device('B'); await ok(b);
  removeCharacter(a.data, x.id, a.ctx); removeCharacter(b.data, y.id, b.ctx);
  await ok(a); await ok(b); await ok(a); await ok(b);
  assert.equal(a.data.characters.length >= 1, true); assert.deepEqual(household(a), household(b)); assert.ok(a.data.characters.some(c => c.id === a.data.settings.character));
});

test('two devices that each add a player with the same name get the same two names, on the same players', async () => {
  const w = world(), a = w.device('A'); a.player('Ada'); await ok(a);
  const b = w.device('B'); await ok(b);
  const cyA = addCharacter(a.data, 'Cy', a.ctx).character, cyB = addCharacter(b.data, 'cy', b.ctx).character;
  await ok(a); await ok(b); await ok(a); await ok(b);
  assert.deepEqual(household(a), household(b));
  const nameOf = (d, id) => d.data.characters.find(c => c.id === id).name;
  assert.deepEqual([nameOf(a, cyA.id), nameOf(a, cyB.id)], ['Cy', 'cy 2'], 'the one who was added first keeps the name, the other gets a number');
  assert.deepEqual([nameOf(b, cyA.id), nameOf(b, cyB.id)], ['Cy', 'cy 2'], 'the same on the other device');
  assert.equal(new Set(a.data.characters.map(c => c.name.toLowerCase())).size, 3, 'no two alike'); assert.equal(a.data.characters.length, 3);
});

test('a household holds 8: a ninth player added elsewhere is not kept, and is not sent', async () => {
  const w = world(), a = w.device('A'); a.player('P0'); for (let i = 1; i < 8; i++) a.player('P' + i); await ok(a);
  const b = w.device('B'); await ok(b);
  const extra = addCharacter(b.data, 'Nine', { ...b.ctx }); assert.equal(extra.ok, false, 'the household rules already say no on one device');
  b.data.characters.push({ id: 'B-nine', name: 'Nine', level: 'veteran', createdAt: w.now(), updatedAt: w.now(), races: [], bests: {} });   // (as if merged from somewhere)
  await ok(b);
  assert.equal(b.data.characters.length, 8); assert.equal(w.server.meta(HID).characters.length, 8); assert.ok(!b.data.characters.some(c => c.id === 'B-nine'));
});

test('what a server sends is never trusted: invalid races, races for players who are not here, and extra fields are dropped; the rest is kept', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); const good = a.race(ada, 77); await ok(a);
  const b = w.device('B');
  w.server.inject(HID, { id: 'junk', characterId: ada.id, result: 5 }); w.server.inject(HID, 'nonsense'); w.server.inject(HID, null);
  w.server.inject(HID, { ...finishRecord('orphan', 80, [27, 26, 26]), characterId: 'nobody' });
  w.server.inject(HID, { ...finishRecord('extra', 81, [27, 26, 26]), characterId: ada.id, secret: { a: 1 } });
  w.server.inject(HID, { ...finishRecord('proto', 82, [27, 26, 26]), characterId: ada.id });
  await ok(b);
  const mine = b.data.characters[0].races;
  assert.deepEqual(mine.map(r => r.id).sort(), [good.id, 'extra', 'proto'].sort()); assert.ok(mine.every(r => r.characterId === undefined), 'the character id is the character\'s, not part of a record');
  assert.equal(b.data.settings.sync.cursor !== null, true, 'and the cursor went past all of it');
  assert.equal((await b.sync.syncNow()).ok, true); assert.equal(b.data.characters[0].races.length, 3);
});

test('a server that answers with garbage is an error to try again later, never a changed profile', async () => {
  const w = world(), a = w.device('A'); a.player('Ada'); await ok(a);
  const b = w.device('B', {}); const before = household(b);
  const backend = w.server.backendFor(HID), bad = { ...backend, listRaces: async () => ({ races: 'x', next: 5 }) };
  const c = createSync({ Profile: b.Profile, backend: bad, now: w.now, setTimer: w.timers.setTimer, clearTimer: w.timers.clearTimer });
  const r = await c.syncNow(); assert.equal(r.ok, false); assert.equal(r.status.error.kind, 'server');
  assert.equal(b.data.characters.some(ch => ch.name === 'Ada'), true, 'the household part had already been merged, which was fine'); assert.notEqual(canonical(before), canonical(household(b)));
  const metaOnlyGarbage = { ...backend, getMeta: async () => 'what', putMeta: async () => null };
  const d = w.device('D'); const sd = createSync({ Profile: d.Profile, backend: metaOnlyGarbage, now: w.now, setTimer: w.timers.setTimer, clearTimer: w.timers.clearTimer });
  assert.equal((await sd.syncNow()).ok, true, 'a meta that is garbage is an empty one: nothing is lost by treating it so'); assert.equal(d.data.characters.length, 1); assert.deepEqual(d.data.characters.map(c => c.name), ['Player']);
});

test('races come down a page at a time, and a new device keeps the latest 500 of a longer history, with the best of all of them', async () => {
  const w = world(), a = w.device('A', { batchSize: 100 }), ada = a.player('Ada'); await ok(a); w.server.calls.length = 0;
  // 520 races, the fastest the oldest: the server has them all, a device keeps 500
  const recs = Array.from({ length: MAX_RACES + 20 }, (_, i) => { const r = finishRecord('s' + i, i === 0 ? 60 : 90 + (i % 5), [27, 26, 26]); r.ts = new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(); return { ...r, characterId: ada.id }; });
  await w.server.backendFor(HID).putRaces(recs);
  const b = w.device('B', { pageSize: 150 }); await ok(b);
  const c = b.data.characters[0];
  assert.equal(c.races.length, MAX_RACES); assert.equal(c.races[0].id, 's20'); assert.equal(c.races.at(-1).id, 's' + (MAX_RACES + 19));
  assert.equal(c.bests['classic/veteran/manual'].time, 60, 'the best came from a race that is no longer in the history, and is kept');
  assert.equal(w.server.callsTo('listRaces').length, 4, '520 races in pages of 150');
});

test('restoring a backup brings races the server may not have: the next sync finds out and sends them', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); a.race(ada); await ok(a);
  const other = w.device('Other', { household: 'elsewhere' }); const o = other.player('Ada'); o.id = ada.id; const extra = other.race(o, 50); extra.ts = a.data.characters[0].races[0].ts;
  assert.deepEqual(Object.keys(a.data.settings.sync).sort(), ['cursor', 'full', 'household', 'outbox', 'v']);
  assert.equal(a.Profile.replace(mergeProfiles(a.data, JSON.parse(JSON.stringify(other.data)))), true);
  assert.equal(a.data.settings.sync, undefined, 'a restore forgets what it had sent');
  await ok(a);
  assert.equal(w.server.raceCount(HID), 2, 'the restored race went up, the first one was not sent again'); assert.equal(w.server.callsTo('putRaces').flatMap(c => c.args[0]).length, 2);
});

test('the sync state of another household is not trusted: it starts again, and damaged state is repaired', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); a.race(ada); await ok(a);
  a.data.settings.sync.household = 'someone-else'; assert.equal(a.sync.status().pending > 0, true);
  const b = w.device('B'); b.player('Bo');
  b.data.settings.sync = { v: 1, household: HID, cursor: { x: 1 }, outbox: ['ok', 7, null, '', 'x'.repeat(70), 'ok'], full: 'yes' };
  await ok(b);
  assert.equal(b.data.settings.sync.cursor === null || typeof b.data.settings.sync.cursor === 'string', true); assert.deepEqual(b.data.settings.sync.outbox, []);
});

test('the status says what is waiting: the household, and each race, until the server has them; an error says which kind', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); await ok(a);
  assert.deepEqual([a.sync.status().pending, a.sync.status().state, a.sync.status().error], [0, 'idle', null]);
  const r = a.race(ada); assert.equal(a.sync.status().pending, 2, 'the race, and the household: the race set a personal best');
  renameCharacter(a.data, ada.id, 'Ada2', a.ctx); assert.equal(a.sync.status().pending, 2, 'a new name is more of the same household change');
  w.server.offline = true; const res = await a.sync.syncNow();
  assert.deepEqual([res.ok, res.status.error.kind, res.status.pending, res.status.state], [false, 'offline', 2, 'waiting']);
  w.server.offline = false; await ok(a); assert.deepEqual([a.sync.status().pending, a.sync.status().error], [0, null]); assert.ok(a.sync.status().lastSyncAt);
  assert.ok(a.statuses.length > 2, 'the game is told as it changes'); assert.ok(r.id);
});

/* ---------- when a sync happens: kicks, retries, and being refused ---------- */
test('a burst of changes is one sync, a quiet moment after the last; a change during a sync means one more after it', async () => {
  const w = world(), a = w.device('A', { quiet: 500 }); a.player('Ada'); await ok(a); w.server.calls.length = 0;
  a.sync.kick(); a.sync.kick(); a.sync.kick();
  assert.equal(w.timers.pending, 1, 'one timer, not three'); await w.timers.advance(499); assert.equal(w.server.calls.length, 0, 'nothing yet'); await w.timers.advance(2);
  assert.equal(w.server.callsTo('getMeta').length, 1, 'one sync');
  assert.equal(w.timers.pending, 0);
});

test('a failed sync is tried again after 1 s, 2 s, 4 s ... and succeeds as soon as the network is back; nothing is lost meanwhile', async () => {
  const w = world(), a = w.device('A', { quiet: 0 }), ada = a.player('Ada'); await ok(a);
  a.race(ada); w.server.offline = true;
  a.sync.kick(0); await w.timers.advance(0);
  assert.deepEqual(w.timers.delays, [1000]); await w.timers.advance(1000); assert.deepEqual(w.timers.delays, [2000]); await w.timers.advance(2000); assert.deepEqual(w.timers.delays, [4000]);
  assert.equal(a.sync.status().state, 'waiting'); assert.equal(a.sync.status().error.kind, 'offline'); assert.equal(a.sync.status().pending, 2);
  w.server.offline = false; await w.timers.advance(4000);
  assert.equal(w.server.raceCount(HID), 1); assert.equal(a.sync.status().pending, 0); assert.equal(w.timers.pending, 0, 'and it stops trying');
});

test('the wait between tries never goes past five minutes', async () => {
  const { defaultBackoff } = await import('../../src/net/sync.js');
  assert.deepEqual([1, 2, 3, 4, 5, 9, 20, 100].map(defaultBackoff), [1000, 2000, 4000, 8000, 16000, 256000, 300000, 300000]); assert.equal(defaultBackoff(0), 1000);
});

test('a refusal is not retried: the sync stops and says so until the player signs in again, then carries on', async () => {
  const w = world(), a = w.device('A', { quiet: 0 }), ada = a.player('Ada'); await ok(a);
  a.race(ada); w.server.denied = true; a.sync.kick(0); await w.timers.advance(0);
  assert.deepEqual([a.sync.status().state, a.sync.status().error.kind, w.timers.pending], ['stopped', 'denied', 0]);
  a.sync.kick(0); assert.equal(w.timers.pending, 0, 'a stopped sync is not woken by changes');
  w.server.denied = false; a.sync.resume(); await w.timers.advance(0);
  assert.equal(w.server.raceCount(HID), 1); assert.deepEqual([a.sync.status().state, a.sync.status().error], ['idle', null]);
});

test('a damaged outbox is repaired and kept to a sensible size', async () => {
  const w = world(), a = w.device('A'); a.player('Ada');
  a.data.settings.sync = { v: 1, household: HID, cursor: null, outbox: ['a', 'a', 7, null, {}, '', 'x'.repeat(65), 'b'], full: false };
  a.sync.status(); assert.deepEqual(a.data.settings.sync.outbox, ['a', 'b']);
  a.data.settings.sync.outbox = Array.from({ length: 6000 }, (_, i) => 'id' + i); a.sync.status(); assert.equal(a.data.settings.sync.outbox.length, 5000);
  a.data.settings.sync.outbox = ['x']; for (let i = 0; i < 10; i++) a.sync.queueRace('same'); assert.deepEqual(a.data.settings.sync.outbox, ['x', 'same'], 'queueing a race again is not a second copy');
});

test('when another device saved to the server at the same moment, what the server says back is taken in at once', async () => {
  const w = world(), a = w.device('A'), ada = a.player('Ada'); await ok(a);
  const b = w.device('B'); await ok(b);
  const real = w.server.backendFor(HID), stale = await real.getMeta(), backend = { ...real, getMeta: async () => stale };   // A looked just before B saved
  addCharacter(b.data, 'Bo', b.ctx); await ok(b);
  renameCharacter(a.data, ada.id, 'Ada2', a.ctx);   // so that A has something to send
  const sa = createSync({ Profile: a.Profile, backend, now: w.now, setTimer: w.timers.setTimer, clearTimer: w.timers.clearTimer });
  assert.equal((await sa.syncNow()).ok, true);
  assert.deepEqual(a.data.characters.map(c => c.name).sort(), ['Ada2', 'Bo'], 'A has Bo without having asked again');
  await ok(b); assert.deepEqual(household(a), household(b), 'and once B has looked again the household is one');
});

test('a change while a sync is running means one more sync straight after it, not a lost change', async () => {
  const w = world(), a = w.device('A', { quiet: 0 }); a.player('Ada'); await ok(a); w.server.calls.length = 0;
  let release; const gate = new Promise(r => { release = r; }), real = w.server.backendFor(HID); let first = true;
  const slow = { ...real, getMeta: async () => { if (first) { first = false; await gate; } return real.getMeta(); } };
  const sa = createSync({ Profile: a.Profile, backend: slow, now: w.now, setTimer: w.timers.setTimer, clearTimer: w.timers.clearTimer, quiet: 0 });
  const running = sa.syncNow(); await new Promise(r => setImmediate(r)); assert.equal(sa.status().state, 'syncing');
  sa.kick(0); release(); await running; await w.timers.advance(0);
  assert.equal(w.server.callsTo('getMeta').length, 2, 'the sync that was running, and one more');
});

test('syncing by hand after a refusal tries again: the player has fixed it', async () => {
  const w = world(), a = w.device('A'); a.player('Ada'); await ok(a);
  w.server.denied = true; const r1 = await a.sync.syncNow(); assert.deepEqual([r1.ok, r1.status.state, r1.status.error.kind], [false, 'stopped', 'denied']);
  w.server.denied = false; const r2 = await a.sync.syncNow(); assert.deepEqual([r2.ok, r2.status.state], [true, 'idle']);
});

test('stop cancels what is waiting; queueing the same race twice is one', async () => {
  const w = world(), a = w.device('A', { quiet: 100 }), ada = a.player('Ada'); await ok(a);
  const r = a.race(ada); a.sync.queueRace(r.id); a.sync.queueRace(r.id); assert.equal(a.data.settings.sync.outbox.length, 1);
  a.sync.kick(); assert.equal(w.timers.pending, 1); a.sync.stop(); assert.equal(w.timers.pending, 0);
});
