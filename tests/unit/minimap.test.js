import test from 'node:test';
import assert from 'node:assert/strict';
import { createMinimap } from '../../src/render/minimap.js';
import { fakeCanvas, fakeDoc } from '../helpers/fakes.js';
import { Sim } from '../helpers/sim.js';

const { T, N } = Sim;
const setup = () => {
  const canvas = fakeCanvas({ clientWidth: 100, clientHeight: 100 }), doc = fakeDoc(), S = Sim.create();
  Sim.reset(S, 'race');
  return { canvas, doc, S, map: createMinimap({ canvas, S, T, N, doc }) };
};

test('the track outline is drawn once, into an offscreen canvas, when the map is created', () => {
  const { doc } = setup();
  assert.equal(doc.created.length, 1);
  const off = doc.created[0];
  assert.deepEqual([off.width, off.height], [200, 200]);
  assert.ok(off.ctx.count('stroke') >= 2, 'a pale outline and a dark road');
  assert.ok(off.ctx.count('lineTo') >= 2 * N, 'every track sample, twice');
});

test('each frame clears the map, draws the stored outline, then a marker for every car', () => {
  const { canvas, S, map } = setup();
  map.draw();
  const c = canvas.ctx;
  assert.deepEqual([c.calls[0][0], c.calls[1][0]], ['clearRect', 'drawImage']);
  assert.equal(c.count('arc'), S.cars.length, 'one dot per living car');
  const radii = c.calls.filter(x => x[0] === 'arc').map(x => x[3]);
  assert.equal(radii.filter(r => r === 8).length, 1, 'the player is bigger');
  assert.equal(radii.filter(r => r === 5.5).length, S.cars.length - 1);
});

test('a wrecked car is a cross, not a dot', () => {
  const { canvas, S, map } = setup();
  S.cars[2].alive = false;
  map.draw();
  assert.equal(canvas.ctx.count('arc'), S.cars.length - 1);
  assert.ok(canvas.ctx.calls.filter(x => x[0] === 'moveTo').length >= 2, 'the two strokes of the cross');
});

test('cars are placed inside the 200 by 200 map', () => {
  const { canvas, S, map } = setup();
  map.draw();
  for (const [name, x, y] of canvas.ctx.calls) if (name === 'arc') assert.ok(x > 0 && x < 200 && y > 0 && y < 200, `dot at ${x}, ${y}`);
  assert.equal(S.cars.length, 6);
});
