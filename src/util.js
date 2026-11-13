// Tiny pure helpers shared by the shell modules. (The simulation keeps its own copies so it depends on nothing.)
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
