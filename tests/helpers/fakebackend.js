// An in-memory backend for the sync tests: the same contract as a real one (src/net/backend.js), with the server's rules, and the ways a network fails.
//   const server = createFakeServer();
//   const backend = server.backendFor('house-1');          // what a device holds
//   server.offline = true                                  // every call throws BackendError('offline')
//   server.denied = true                                   // every call throws BackendError('denied')
//   server.failNext('putRaces', { kind: 'offline', afterApply: true })   // the next call fails; with afterApply the server did the work, then the answer was lost
//   server.calls                                           // [{ method, args }] in order, to say what a device asked for
import { BackendError } from '../../src/net/backend.js';
import { mergeMeta, cleanMeta } from '../../src/net/merge.js';
import { cleanRecord } from '../../src/records.js';

export function createFakeServer() {
  const houses = new Map();
  const server = { offline: false, denied: false, calls: [], failures: [], houses };
  const house = id => { if (!houses.has(id)) houses.set(id, { meta: { characters: [], deleted: {} }, races: [], seq: 0 }); return houses.get(id); };

  server.failNext = (method, opts = {}) => server.failures.push({ method, kind: opts.kind || 'offline', afterApply: !!opts.afterApply });
  server.meta = id => house(id).meta;
  server.races = id => house(id).races.map(r => r.rec);
  server.raceCount = id => house(id).races.length;
  // Puts a raw record on the server's list, as a bug or an attacker could (it is not checked)
  server.inject = (id, raw) => { const h = house(id); h.races.push({ seq: ++h.seq, rec: raw }); };
  server.callsTo = method => server.calls.filter(c => c.method === method);

  server.backendFor = hid => {
    const h = () => house(hid);
    const wrap = (method, fn) => async (...args) => {
      server.calls.push({ method, args: JSON.parse(JSON.stringify(args)) });
      if (server.denied) throw new BackendError('denied', 'the key is not accepted');
      if (server.offline) throw new BackendError('offline', 'no connection');
      const i = server.failures.findIndex(f => f.method === method);
      const fail = i >= 0 ? server.failures.splice(i, 1)[0] : null;
      if (fail && !fail.afterApply) throw new BackendError(fail.kind, 'injected failure');
      const result = JSON.parse(JSON.stringify(await fn(...args)));   // (what comes back is a copy, as over a network)
      if (fail) throw new BackendError(fail.kind, 'the answer was lost');
      return result;
    };
    return {
      getMeta: wrap('getMeta', () => ({ characters: h().meta.characters, deleted: h().meta.deleted })),
      putMeta: wrap('putMeta', incoming => {
        const hh = h(); hh.meta = mergeMeta(hh.meta, cleanMeta(incoming));
        const alive = new Set(hh.meta.characters.map(c => c.id));
        hh.races = hh.races.filter(r => !r.rec || typeof r.rec !== 'object' || alive.has(r.rec.characterId));   // deleting a character deletes their races
        return hh.meta;
      }),
      putRaces: wrap('putRaces', records => {
        const hh = h(), alive = new Set(hh.meta.characters.map(c => c.id)), ids = new Set(hh.races.filter(r => r.rec).map(r => r.rec.id));
        let n = 0;
        for (const raw of records) {
          const { characterId, ...rest } = raw, rec = cleanRecord(rest);
          if (!rec || !alive.has(characterId) || ids.has(rec.id)) continue;
          ids.add(rec.id); hh.races.push({ seq: ++hh.seq, rec: { ...rec, characterId } }); n++;
        }
        return { accepted: n };
      }),
      listRaces: wrap('listRaces', ({ after, limit }) => {
        const hh = h(), from = after === null || after === undefined ? 0 : Number(after), page = hh.races.filter(r => r.seq > from).slice(0, limit);
        const last = page.length ? page[page.length - 1].seq : from;
        return { races: page.map(r => r.rec), next: String(last), done: !hh.races.some(r => r.seq > last) };
      }),
      listRaceIds: wrap('listRaceIds', characterId => h().races.filter(r => r.rec && r.rec.characterId === characterId).map(r => r.rec.id)),
      deleteHousehold: wrap('deleteHousehold', () => { houses.delete(hid); })
    };
  };
  return server;
}

// Timers the test controls: setTimer / clearTimer for createSync, and advance(ms) to run what is due (awaiting what that starts).
export function fakeTimers() {
  let t = 0, nextId = 1; const pending = new Map();
  return {
    setTimer: (fn, ms) => { const id = nextId++; pending.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => { pending.delete(id); },
    get pending() { return pending.size; },
    get delays() { return [...pending.values()].map(p => p.at - t); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]); t = Math.max(t, due[1].at); due[1].fn();
        for (let i = 0; i < 50; i++) await Promise.resolve();   // let what the timer started run (the awaits inside a sync)
        await new Promise(r => setImmediate(r));
      }
      t = end;
    }
  };
}
