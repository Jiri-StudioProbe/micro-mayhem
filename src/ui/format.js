// Text formatting for the HUD and the results screen. Pure. Moved verbatim out of src/main.js in M0.7.
export const ord = n => n + (['TH', 'ST', 'ND', 'RD'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
// m:ss.t (or m:ss.hh with digits = 2). The time is rounded first, so that 59.97 s reads 1:00.0, not 0:60.0.
export function fmtTime(t, digits = 1) { const k = 10 ** digits, r = Math.round(t * k) / k, m = Math.floor(r / 60), s = r - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(digits); }
