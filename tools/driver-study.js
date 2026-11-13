// Headless driver study: how fast can different "human models" lap the track, with and without the driving assist?
// Usage: node tools/driver-study.js [runs]
import { loadSim } from '../tests/helpers/sim.js';
import { makeDrivers, runRace } from '../tests/helpers/drivers.js';

const Sim = loadSim(), drivers = makeDrivers(Sim);
const RUNS = Number(process.argv[2]) || 12;
const avg = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);

const rows = [
  ['keyboard', 'keyboard', {}],
  ['thumb', 'thumb', {}],
  ['thumb + Rookie assist (lane 1.5, speed 1.5)', 'thumb', { assist: true, lane: 1.5, speed: 1.5 }],
  ['thumb + Veteran assist (lane 0.3, speed 1.1)', 'thumb', { assist: true, lane: 0.3, speed: 1.1 }],
  ['keyboard + Rookie assist', 'keyboard', { assist: true, lane: 1.5, speed: 1.5 }]
];
for (const [label, model, opts] of rows) {
  const rs = Array.from({ length: RUNS }, () => runRace(Sim, drivers, model, opts));
  const fin = rs.filter(r => r.kind === 'finish');
  console.log(label.padEnd(46), 'wins', `${rs.filter(r => r.place === 1).length}/${RUNS}`, 'avg place', avg(rs.map(r => r.place)),
    'avg time', avg(fin.map(r => r.time)), 'wall hits', avg(rs.map(r => r.crashes)));
}
