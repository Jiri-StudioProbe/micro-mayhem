// Seeded random numbers for the simulation. The same seed always gives the same sequence, on every device and every run,
// which is what makes a race repeatable (and so replayable, testable and verifiable).
// mulberry32 (public domain): 32 bits of state, passes the usual statistical tests, and is a few integer operations per number,
// all done with Math.imul and >>> so the result is identical in every JavaScript engine.

// A function that returns the next number in [0, 1) each time it is called.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Several independent streams from one seed: `salt` picks the stream. (A bare `seed ^ salt` would make neighbouring seeds produce
// shifted copies of each other's streams; the multiplications and shifts scramble that away.)
export function deriveSeed(seed, salt) {
  let h = (seed >>> 0) ^ Math.imul((salt >>> 0) + 1, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}
