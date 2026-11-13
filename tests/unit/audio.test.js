import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../src/audio.js';

// A minimal WebAudio stand-in that records what the game asks of it.
class Param { constructor() { this.value = 0; this.calls = []; } setValueAtTime(...a) { this.calls.push(['set', ...a]); } exponentialRampToValueAtTime(...a) { this.calls.push(['ramp', ...a]); } setTargetAtTime(...a) { this.calls.push(['target', ...a]); } }
class Node { connect() {} start() { this.started = true; } stop() { this.stopped = true; } }
class FakeAC {
  constructor() { this.currentTime = 10; this.state = 'running'; this.sampleRate = 100; this.destination = {}; this.oscillators = []; this.gains = []; this.suspends = 0; this.resumes = 0; FakeAC.instances.push(this); }
  createGain() { const g = new Node(); g.gain = new Param(); this.gains.push(g); return g; }
  createOscillator() { const o = new Node(); o.frequency = new Param(); this.oscillators.push(o); return o; }
  createBiquadFilter() { const f = new Node(); f.frequency = new Param(); return f; }
  createBufferSource() { return new Node(); }
  createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
  suspend() { this.state = 'suspended'; this.suspends++; }
  resume() { this.state = 'running'; this.resumes++; }
}
FakeAC.instances = [];
const player = { x: 0, y: 0 };
const make = (extra = {}) => { FakeAC.instances.length = 0; return createAudio({ getPlayer: () => player, AudioContextClass: FakeAC, ...extra }); };

test('before the first user gesture every call is a harmless no-op', () => {
  const a = make();
  assert.equal(a.ready, false);
  assert.doesNotThrow(() => { a.tone(440, 0.1); a.noise(0.1, 0.2); a.engine(100, true, true); a.setMuted(true); a.setMuted(false); });
  assert.equal(FakeAC.instances.length, 0, 'nothing was created');
});

test('init creates one audio context, only once; a second init just wakes it', () => {
  const a = make(); a.init();
  assert.equal(a.ready, true); assert.equal(FakeAC.instances.length, 1);
  const ac = FakeAC.instances[0]; ac.state = 'suspended';
  a.init();
  assert.equal(FakeAC.instances.length, 1); assert.equal(ac.resumes, 1);
});

test('tones play, and stop playing when muted', () => {
  const a = make(); a.init(); const ac = FakeAC.instances[0], base = ac.oscillators.length;
  a.tone(440, 0.1, 'square', 0.1, -100);
  assert.equal(ac.oscillators.length, base + 1);
  const o = ac.oscillators.at(-1); assert.ok(o.started && o.stopped); assert.equal(o.type, 'square');
  a.setMuted(true);
  a.tone(440, 0.1); a.noise(0.1, 0.2);
  assert.equal(ac.oscillators.length, base + 1, 'no new tone while muted');
  a.setMuted(false); a.tone(440, 0.1);
  assert.equal(ac.oscillators.length, base + 2);
});

test('muting suspends the context and unmuting resumes it', () => {
  const a = make(); a.init(); const ac = FakeAC.instances[0];
  a.setMuted(true); assert.equal(a.muted, true); assert.equal(ac.state, 'suspended');
  a.setMuted(false); assert.equal(a.muted, false); assert.equal(ac.state, 'running');
});

test('the engine hum follows speed and throttle, and is silent when off or muted', () => {
  const a = make(); a.init(); const ac = FakeAC.instances[0];
  const hum = ac.oscillators[0], humGain = ac.gains[1];   // init builds the master gain first, then the engine's
  a.engine(200, true, true);
  assert.deepEqual(hum.frequency.calls.at(-1), ['target', 52 + 200 * 0.26 + 14, 10, 0.05], 'pitch rises with speed, and with the throttle down');
  assert.deepEqual(humGain.gain.calls.at(-1), ['target', 0.05, 10, 0.1], 'audible while racing');
  a.engine(200, false, true);
  assert.deepEqual(hum.frequency.calls.at(-1), ['target', 52 + 200 * 0.26, 10, 0.05]);
  a.engine(0, false, false);
  assert.equal(humGain.gain.calls.at(-1)[1], 0, 'silent on menus and after the race');
  a.setMuted(true); a.engine(200, true, true);
  assert.equal(humGain.gain.calls.at(-1)[1], 0, 'silent when muted');
  a.setMuted(false); a.engine(200, true, true);
  assert.equal(humGain.gain.calls.at(-1)[1], 0.05, 'and back when unmuted');
});

test('loudness falls with distance from the player, within limits', () => {
  const a = make();
  assert.equal(a.vol(0, 0), 1);
  assert.ok(Math.abs(a.vol(325, 0) - 0.5) < 1e-9);
  assert.equal(a.vol(650, 0), 0.08); assert.equal(a.vol(5000, 5000), 0.08);
  player.x = 100; assert.equal(a.vol(100, 0), 1); player.x = 0;
});

test('no WebAudio at all, or a context that cannot be built, never breaks the game', () => {
  const none = createAudio({ getPlayer: () => player, AudioContextClass: null });
  assert.doesNotThrow(() => { none.init(); none.tone(1, 1); none.noise(1, 1); none.engine(1, true, true); none.setMuted(true); });
  assert.equal(none.ready, false);
  class Broken { constructor() { throw new Error('not allowed'); } }
  const broken = createAudio({ getPlayer: () => player, AudioContextClass: Broken });
  assert.doesNotThrow(() => broken.init()); assert.equal(broken.ready, false);
});

test('a failed init can be retried on the next gesture', () => {
  let fail = true;
  class Flaky extends FakeAC { constructor() { if (fail) throw new Error('blocked'); super(); } }
  const a = createAudio({ getPlayer: () => player, AudioContextClass: Flaky });
  a.init(); assert.equal(a.ready, false);
  fail = false; a.init(); assert.equal(a.ready, true);
});

test('hiding the page suspends sound; showing it resumes sound, unless muted', () => {
  const listeners = {}, doc = { hidden: false, addEventListener: (n, f) => { listeners[n] = f; } };
  const a = make({ doc }); a.init(); const ac = FakeAC.instances[0];
  doc.hidden = true; listeners.visibilitychange(); assert.equal(ac.state, 'suspended');
  doc.hidden = false; listeners.visibilitychange(); assert.equal(ac.state, 'running');
  a.setMuted(true); doc.hidden = true; listeners.visibilitychange(); doc.hidden = false; listeners.visibilitychange();
  assert.equal(ac.state, 'suspended', 'a muted game stays silent when the tab comes back');
});
