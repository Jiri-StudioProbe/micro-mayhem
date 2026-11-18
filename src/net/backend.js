// The contract between the game and whatever stores a household online (M3.2). The sync engine (sync.js) is written against this and nothing else,
// so the provider can be chosen, or changed, later (M3.3): it is a small adapter, not a rewrite. Every method is async and is for ONE household
// (the adapter is made for it: signed in, joined with its key). Anything it returns is untrusted: the engine cleans it all.
//
//   getMeta()                -> { characters: [row], deleted: { id: when } }
//        The household's shared state, without races. A row is a character without `races` (see src/net/merge.js).
//   putMeta(meta)            -> the meta as it is stored afterwards
//        Merges `meta` into what is stored, with mergeMeta from src/net/merge.js (or the equivalent): a join, so sending the same thing twice, or
//        two devices sending at once, is harmless. A character with a tombstone is deleted for good, **and so are their races**.
//   putRaces([record])       -> any value
//        Stores race records, each with a `characterId`. Idempotent: a record whose id is already stored is ignored; a record for a character that
//        is not there (or is deleted) is ignored. Races are never changed or removed one by one.
//   listRaces({ after, limit }) -> { races: [record + characterId], next, done }
//        The stored races in the order they were stored, `limit` at a time, after the cursor `after` (null: from the start). `next` is the cursor
//        to continue from (an opaque string); `done` says there are no more for now.
//   listRaceIds(characterId) -> [id]
//        The ids of the races stored for a character (for a device that has to find out what the server lacks).
//
// A failure is a BackendError with a `kind`:
//   'offline'  no connection, or the server could not be reached: try again later, nothing is wrong
//   'denied'   the household's key or sign-in is not accepted: retrying will not help, the player has to act
//   'server'   anything else (an error from the server, an answer that makes no sense): try again later
export class BackendError extends Error {
  constructor(kind, message) { super(message || kind); this.name = 'BackendError'; this.kind = kind; }
}
export const errorKind = e => (e && (e.kind === 'offline' || e.kind === 'denied') ? e.kind : 'server');
