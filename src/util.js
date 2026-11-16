// Tiny pure helpers shared by the shell modules. (The simulation keeps its own copies so it depends on nothing.)
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// A fresh seed for a session: the one place the game asks for real randomness. Everything after it is a function of the seed.
export const newSeed = () => (Math.random() * 4294967296) >>> 0;
// A fresh random id (a UUID where the browser has one). Made on the device, so that what is uploaded twice later is still one thing.
export function newId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
// Copies an object's own fields, except `__proto__`: a stored document is untrusted, and JSON.parse makes `__proto__` an ordinary own field,
// which Object.assign would then use to replace the copy's prototype.
export const ownCopy = o => { const out = {}; for (const k of Object.keys(o)) if (k !== '__proto__') out[k] = o[k]; return out; };
