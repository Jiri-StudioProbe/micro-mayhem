// The sync engine (M3.2): keeps a household's profile in step with a backend (src/net/backend.js), whatever order devices sync in, however often,
// with the network coming and going. Written against the backend contract only, and tested against a fake (tests/helpers/fakebackend.js).
//
// A sync is: (1) fetch the household's META (characters' rows, tombstones), merge it with ours (src/net/merge.js, a join), keep the result, and
// send it back if the server lacked something; (2) upload the races in the OUTBOX; (3) download the races stored since our CURSOR.
//   - Races never change, so they need no merging: they are collected by id. The outbox and the cursor are saved in the profile after every step,
//     so a sync that is cut off (the network, a closed tab) carries on where it stopped, and a race that is sent twice is stored once.
//   - The first sync of a profile for a household (`full`), and the first after a backup restore, also asks which races the server already has, so
//     that everything that is only here is uploaded. That is also how a household that has only ever lived on one device is put online.
//   - A new device that has only its unused default Player gives it up for the household's characters (it is not uploaded).
// This module touches the profile only through Profile.data and Profile.save, and the network only through the backend.
import { cleanRecord, bestsFromRaces } from '../records.js';
import { mergeCharacter, isPristine, newCharacter } from '../household.js';
import { cleanMeta, mergeMeta, metaEqual, metaOf, rowOf, fitHousehold, canonical } from './merge.js';
import { errorKind } from './backend.js';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_OUTBOX = 5000;

export const defaultBackoff = attempt => Math.min(300000, 1000 * 2 ** Math.max(0, attempt - 1));   // 1 s, 2 s, 4 s ... at most 5 minutes

export function createSync({ Profile, backend, now = () => new Date().toISOString(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id),
  onChange = () => {}, onStatus = () => {}, pageSize = 200, batchSize = 100, backoff = defaultBackoff, quiet = 500 }) {
  let running = null, again = false, timer = null, attempt = 0, stopped = false, lastError = null, lastSyncAt = null, lastRemote = null, retrying = false;

  // This device's sync state, kept in the profile's (per-device) settings: { v, household, cursor, outbox, full }. Whatever is stored is checked.
  function state() {
    const data = Profile.data, s = data.settings.sync;
    if (!isObject(s) || s.v !== 1 || s.household !== data.household.id) return (data.settings.sync = { v: 1, household: data.household.id, cursor: null, outbox: [], full: true });
    if (typeof s.cursor !== 'string' || s.cursor.length > 64) s.cursor = null;
    s.outbox = Array.isArray(s.outbox) ? [...new Set(s.outbox.filter(x => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, MAX_OUTBOX) : [];
    s.full = s.full !== false;
    return s;
  }

  const status = () => ({
    state: running ? 'syncing' : stopped ? 'stopped' : retrying ? 'waiting' : 'idle',
    // what the server lacks: each race in the outbox, and the household's part (its characters, and their bests) if that has changed since the server
    // last had it, or has never been checked (a first sync, or the first after a restore)
    pending: state().outbox.length + (!lastRemote || state().full || !metaEqual(mergeMeta(lastRemote, metaOf(Profile.data)), lastRemote) ? 1 : 0),
    error: lastError, lastSyncAt
  });
  let lastEmitted = '';
  const emit = () => { const s = status(), key = JSON.stringify(s); if (key !== lastEmitted) { lastEmitted = key; onStatus(s); } };

  // Makes this profile's characters those of `meta`: rows replace rows (the races stay with their character), those with a tombstone go (with their
  // races), the household's tombstones are updated, and the character who plays is still one of them. Returns whether anything changed.
  function apply(meta) {
    const data = Profile.data, before = canonical([metaOf(data), data.settings.character]);
    const next = meta.characters.map(row => { const old = data.characters.find(c => c.id === row.id); return { ...row, races: old ? old.races : [] }; });
    data.characters.splice(0, data.characters.length, ...next);
    data.household.deleted = { ...meta.deleted };
    if (!data.characters.some(c => c.id === data.settings.character)) data.settings.character = data.characters[0].id;
    return before !== canonical([metaOf(data), data.settings.character]);
  }

  async function syncMeta(st) {
    const data = Profile.data, remote = cleanMeta(await backend.getMeta());
    let local = metaOf(data);
    // a new device: its unused default Player is not a member of the household, it makes way for the household's characters (on a device that has
    // synced before, a Player like that is the household's own, and the server's copy of it is merged back in)
    if (remote.characters.length && data.characters.length === 1 && isPristine(data.characters[0])) local = { characters: [], deleted: local.deleted };
    let merged = mergeMeta(local, remote);
    const fit = fitHousehold(merged, now());
    merged = { characters: fit.characters, deleted: merged.deleted };
    if (!merged.characters.length) { const c = newCharacter({}, { now }); merged = { ...merged, characters: [rowOf(c)] }; }   // (devices deleted a player each: a household always has someone)
    let changed = apply(merged);
    if (!metaEqual(mergeMeta(remote, merged), remote)) {   // the server lacks something of ours
      const stored = cleanMeta(await backend.putMeta(merged));
      lastRemote = stored;
      const again_ = mergeMeta(merged, stored);   // (a device that synced at the same moment may have added to it)
      if (!metaEqual(again_, merged)) changed = apply(again_) || changed;
    } else lastRemote = remote;
    return changed;
  }

  async function uploadRaces(st) {
    const data = Profile.data;
    if (st.full) {   // find out what the server already has, so that only what it lacks is sent
      for (const c of data.characters) {
        const have = new Set(await backend.listRaceIds(c.id));
        for (const r of c.races) if (!have.has(r.id) && !st.outbox.includes(r.id)) st.outbox.push(r.id);
      }
      st.full = false; Profile.save();
    }
    while (st.outbox.length) {
      const ids = st.outbox.slice(0, batchSize), index = new Map();
      for (const c of data.characters) for (const r of c.races) if (ids.includes(r.id)) index.set(r.id, { ...r, characterId: c.id });
      const records = ids.filter(id => index.has(id)).map(id => index.get(id));   // (one that is gone, trimmed away or with a deleted player, is not sent)
      if (records.length) await backend.putRaces(records);
      st.outbox.splice(0, ids.length); Profile.save();
    }
  }

  async function downloadRaces(st) {
    const data = Profile.data; let added = 0;
    for (;;) {
      const page = await backend.listRaces({ after: st.cursor, limit: pageSize });
      if (!isObject(page) || !Array.isArray(page.races) || (page.next !== null && typeof page.next !== 'string')) throw Object.assign(new Error('the server sent a list of races that makes no sense'), { kind: 'server' });
      const have = new Set(data.characters.flatMap(c => c.races.map(r => r.id))), byCharacter = new Map();
      for (const raw of page.races) {
        if (!isObject(raw) || typeof raw.characterId !== 'string') continue;
        const { characterId, ...rest } = raw, rec = cleanRecord(rest);   // (untrusted: a record that is not valid is dropped)
        if (!rec || have.has(rec.id) || !data.characters.some(c => c.id === characterId)) continue;
        have.add(rec.id); if (!byCharacter.has(characterId)) byCharacter.set(characterId, []); byCharacter.get(characterId).push(rec);
      }
      for (const [cid, recs] of byCharacter) {
        const i = data.characters.findIndex(c => c.id === cid);
        data.characters[i] = mergeCharacter(data.characters[i], { races: recs, bests: bestsFromRaces(recs) }, new Set(data.characters.flatMap(c => c.races.map(r => r.id))));
        added += recs.length;
      }
      const moved = page.next !== null && page.next !== st.cursor;   // (a server that does not move the cursor must not keep us here for ever)
      if (moved) st.cursor = page.next;
      if (moved || added) Profile.save();
      if (page.done || !moved || !page.races.length) break;
    }
    return added;
  }

  async function run() {
    const st = state(); let changed = await syncMeta(st); if (changed) Profile.save();
    await uploadRaces(st);
    changed = (await downloadRaces(st)) > 0 || changed;
    if (changed) onChange();
  }

  async function cycle() {
    try { await run(); attempt = 0; retrying = false; lastError = null; lastSyncAt = now(); }
    catch (e) {
      const kind = errorKind(e); lastError = { kind, message: String((e && e.message) || e) };
      if (kind === 'denied') { stopped = true; retrying = false; }   // retrying will not help: the player has to sign in again
      else { retrying = true; attempt++; schedule(backoff(attempt)); }
    }
  }

  function schedule(delay) {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; go(); }, delay); emit();
  }
  async function go() {
    if (running) { again = true; return running; }
    running = cycle(); emit();
    await running; running = null;
    if (again) { again = false; schedule(0); }
    emit();
  }

  return {
    status,
    // Asks for a sync soon (rapid calls become one). `quiet` ms later by default, so that a burst of changes is one sync.
    kick: (delay = quiet) => { if (running) again = true; else schedule(delay); },
    // Syncs now, and says how it went: { ok, status }.
    async syncNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      stopped = false; await go(); if (running) await running;
      return { ok: lastError === null, status: status() };
    },
    // A race was recorded: it goes in the outbox until the server has it. (The caller saves the profile.)
    queueRace(id) { state().outbox.push(id); emit(); },   // (state() drops duplicates and keeps it to a sensible size)
    // After a 'denied': the player signed in again.
    resume() { stopped = false; lastError = null; attempt = 0; schedule(0); },
    stop() { stopped = true; if (timer !== null) { clearTimer(timer); timer = null; } }
  };
}
