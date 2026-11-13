// Stand-ins for the browser's canvas, so the renderer can be tested in Node.
// The fake is strict on purpose: like a real canvas it throws on a negative radius (which used to freeze the game), and it also
// rejects NaN and Infinity coordinates, which a real canvas silently ignores but which always mean a bug in the maths.
const finite = (name, args) => { for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${name}: non-finite argument ${a} in (${args.join(', ')})`); };

export function fakeCtx() {
  const calls = [];
  const rec = (name, check) => (...args) => { finite(name, args); if (check) check(...args); calls.push([name, ...args]); };
  const gradient = () => ({ addColorStop() {} });
  const ctx = {
    calls,
    count: name => calls.filter(c => c[0] === name).length,
    setTransform: rec('setTransform'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), clearRect: rec('clearRect'),
    beginPath: rec('beginPath'), closePath: rec('closePath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    fill: rec('fill'), stroke: rec('stroke'), save: rec('save'), restore: rec('restore'), translate: rec('translate'), rotate: rec('rotate'),
    fillText: rec('fillText'), drawImage: rec('drawImage'),
    arc: rec('arc', (x, y, r) => { if (r < 0) throw new Error(`IndexSizeError: arc radius ${r} is negative`); }),
    ellipse: rec('ellipse', (x, y, rx, ry) => { if (rx < 0 || ry < 0) throw new Error(`IndexSizeError: ellipse radius ${rx}x${ry} is negative`); }),
    createLinearGradient: (...a) => { finite('createLinearGradient', a); calls.push(['createLinearGradient', ...a]); return gradient(); },
    createRadialGradient: (...a) => { finite('createRadialGradient', a); calls.push(['createRadialGradient', ...a]); return gradient(); }
  };
  return ctx;
}

// A canvas element with a size, and a 2D context.
export function fakeCanvas({ clientWidth = 1000, clientHeight = 700 } = {}) {
  const ctx = fakeCtx();
  return { clientWidth, clientHeight, width: 0, height: 0, ctx, getContext: () => ctx };
}

// A document that can create offscreen canvases.
export const fakeDoc = () => ({ created: [], createElement(tag) { const c = fakeCanvas({ clientWidth: 0, clientHeight: 0 }); c.tag = tag; this.created.push(c); return c; } });
