// Backing up and restoring a profile (the household, its characters and the settings of this device) as a code: a piece of text to copy, save or send to yourself, and paste (or load from a file) elsewhere.
//
//   MMP1:<z or r>:<8 hex digits>:<base64url>
//   "MMP1" the format, z = the profile JSON deflated (r = raw, for a browser that cannot compress), the check (CRC-32 of the bytes after it), and the bytes.
//
// The check catches a code that was cut short or altered on its way (pasting through a chat app, a line that wrapped); whitespace in a pasted code is
// ignored. Decoding never trusts the code: the size is limited before and after decompressing (a tiny code can unpack into gigabytes), and what comes
// out is cleaned like a stored profile by cleanProfileDoc, which the caller does. Pure apart from the browser's (and Node's) stream classes.
import { MAX_CHARACTERS, uniqueName, mergeCharacter, isPristine } from './household.js';

export const CODE_MAX = 3000000;      // characters of a code we accept
export const JSON_MAX = 6000000;      // bytes of profile we accept after decompressing
const PREFIX = 'MMP1';

// CRC-32 (the one zip and PNG use).
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0'); }

function toBase64Url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// (Also accepts the standard alphabet and padding: atob does, and nothing is gained by refusing them.)
function fromBase64Url(text) {
  let b; try { b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)); } catch (_) { return null; }
  const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out;
}

const canCompress = () => typeof CompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
const canDecompress = () => typeof DecompressionStream === 'function' && typeof Blob === 'function';
async function deflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
// Inflates, giving up (null) as soon as the result would be bigger than `max`.
async function inflate(bytes, max) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch (_) {} return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; } return out;
}

// The code for a profile document. Compressed whenever the browser can.
export async function encodeBackup(doc, { compress = canCompress() } = {}) {
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  const bytes = compress ? await deflate(raw) : raw;
  return `${PREFIX}:${compress ? 'z' : 'r'}:${crc32(bytes)}:${toBase64Url(bytes)}`;
}

// { ok: true, doc } with the profile document the code holds (not yet cleaned), or { ok: false, error } with a sentence for the player.
export async function decodeBackup(text) {
  const bad = error => ({ ok: false, error });
  if (typeof text !== 'string') return bad('There is no code to read.');
  const code = text.replace(/\s+/g, '');
  if (!code) return bad('Paste a backup code first.');
  if (code.length > CODE_MAX) return bad('That is too big to be a backup code.');
  const m = /^MMP1:([zr]):([0-9a-f]{8}):(.*)$/.exec(code);
  if (!m) return bad('That is not a Micro Mayhem backup code. A code starts with MMP1:');
  const bytes = fromBase64Url(m[3]);
  if (!bytes || crc32(bytes) !== m[2]) return bad('The code is damaged or cut short: it does not match its own check. Copy it again, all of it.');
  let json;
  if (m[1] === 'z') {
    if (!canDecompress()) return bad('This browser cannot read compressed codes. Try a newer one.');
    let out; try { out = await inflate(bytes, JSON_MAX); } catch (_) { return bad('The code could not be unpacked.'); }
    if (!out) return bad('That is too big to be a backup code.');
    json = out;
  } else {
    json = bytes;   // (a raw code is at most CODE_MAX characters, which is far below JSON_MAX bytes, so it needs no check of its own)
  }
  let doc; try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); } catch (_) { return bad('The code does not hold a readable profile.'); }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || doc.settings === null || typeof doc.settings !== 'object' || Array.isArray(doc.settings)) return bad('The code does not hold a profile.');
  return { ok: true, doc };
}

// How many races a decoded (not yet cleaned) document claims to hold, for saying how many damaged records were left out.
export const rawRaceCount = doc => (Array.isArray(doc.characters)
  ? doc.characters.reduce((n, c) => n + (c !== null && typeof c === 'object' && Array.isArray(c.races) ? c.races.length : 0), 0)
  : Array.isArray(doc.races) ? doc.races.length : 0);
// A code from before characters (a version 1 or 2 profile) holds one history and no one to attach it to: `legacy` documents are added to a
// character of this device, `legacyTo` (the one who is playing, as the screen says).
export const isLegacyDoc = doc => !Array.isArray(doc.characters);

const raceIds = p => new Set(p.characters.flatMap(c => c.races.map(r => r.id)));
// How the characters of an imported profile line up with this device's: [{ imp, loc }], loc being the character here it merges into (the same
// id; for a legacy code, `legacyTo`) or null for a character this device does not have.
function pair(local, imported, legacyTo) {
  return imported.characters.map((imp, i) => ({ imp, loc: (legacyTo ? (i === 0 ? local.characters.find(c => c.id === legacyTo) : null) : local.characters.find(c => c.id === imp.id)) || null }));
}

// A device that has only an unused, default character (see isPristine) is a new device: the code's characters take its place.
const replacesPristine = (local, imported, legacyTo) => !legacyTo && local.characters.length === 1 && isPristine(local.characters[0]) && imported.characters.length > 0;

// Adds what an imported profile has to this device's. Characters are matched by id: a character that is here gets the races it lacks (by id; this
// device's copy wins), in date order, the latest 500, and the better of each best; a character this device does not have is added, with a name
// that differs from the others', while there is room (a household holds MAX_CHARACTERS). Settings, names, levels and anything else only this game
// version knows stay as they are here; on a new device (only an unused Player) the code's characters replace that one, and the first of them plays.
// Both arguments are cleaned documents (cleanProfileDoc); neither is changed.
export function mergeProfiles(local, imported, { legacyTo = null } = {}) {
  const fresh = replacesPristine(local, imported, legacyTo), L = fresh ? { ...local, characters: [] } : local;
  const have = raceIds(L), out = L.characters.slice();
  for (const { imp, loc } of pair(L, imported, legacyTo)) {
    if (loc) { out[out.indexOf(loc)] = mergeCharacter(loc, imp, have); continue; }
    if (out.length >= MAX_CHARACTERS) continue;
    out.push({ ...imp, name: uniqueName(imp.name, out.map(c => c.name)), races: imp.races.filter(r => !have.has(r.id)) });
  }
  return { ...local, characters: out, settings: fresh ? { ...local.settings, character: out[0].id } : local.settings, version: Math.max(local.version, imported.version) };
}

// What importing would do, for the screen to say before anything is changed.
export function previewImport(local, imported, rawCount = imported.characters.reduce((n, c) => n + c.races.length, 0), { legacyTo = null } = {}) {
  const fresh = replacesPristine(local, imported, legacyTo), L = fresh ? { ...local, characters: [] } : local;
  const have = raceIds(L), theirs = raceIds(imported);
  let races = 0, newRaces = 0, boards = 0, newBoards = 0, betterBests = 0, newCharacters = 0, droppedCharacters = 0, room = MAX_CHARACTERS - L.characters.length;
  for (const { imp, loc } of pair(L, imported, legacyTo)) {
    races += imp.races.length; boards += Object.keys(imp.bests).length;
    if (!loc) { if (room > 0) { room--; newCharacters++; } else { droppedCharacters++; continue; } }
    newRaces += imp.races.filter(r => !have.has(r.id)).length;
    for (const k of Object.keys(imp.bests)) {
      const mine = loc && Object.prototype.hasOwnProperty.call(loc.bests, k) ? loc.bests[k] : null, t = imp.bests[k];
      if (!mine) { newBoards++; continue; }
      if ((t.time !== null && (mine.time === null || t.time < mine.time)) || (t.bestLap !== null && (mine.bestLap === null || t.bestLap < mine.bestLap))) betterBests++;
    }
  }
  const localOnly = [...have].filter(id => !theirs.has(id)).length;   // what REPLACE would lose
  const into = legacyTo ? (local.characters.find(c => c.id === legacyTo) || {}).name || null : null;
  return { races, newRaces, localOnly, droppedRaces: Math.max(0, rawCount - races), boards, newBoards, betterBests, characters: imported.characters.map(c => c.name),
    newCharacters, droppedCharacters, replacesEmpty: fresh ? local.characters[0].name : null, legacy: !!legacyTo, into, savedAt: typeof imported.updatedAt === 'string' ? imported.updatedAt : null, newerVersion: imported.version > local.version };
}
