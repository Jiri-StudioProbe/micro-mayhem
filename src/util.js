// Tiny pure helpers shared by the shell modules. (The simulation keeps its own copies so it depends on nothing.)
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// A fresh seed for a session: the one place the game asks for real randomness. Everything after it is a function of the seed.
export const newSeed = () => (Math.random() * 4294967296) >>> 0;
