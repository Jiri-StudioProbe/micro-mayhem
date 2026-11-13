// Text formatting for the HUD and the results screen. Pure. Moved verbatim out of src/main.js in M0.7.
export const ord = n => n + (['TH', 'ST', 'ND', 'RD'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
export function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
