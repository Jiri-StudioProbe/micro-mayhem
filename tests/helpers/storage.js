// localStorage stand-ins for unit tests.
export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m, writes: 0,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { this.writes++; m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }
  };
}
export const throwingStorage = (what = 'all') => ({
  getItem() { if (what !== 'set') throw new Error('storage unavailable'); return null; },
  setItem() { if (what !== 'get') throw new Error('quota exceeded'); },
  removeItem() { throw new Error('storage unavailable'); }
});
