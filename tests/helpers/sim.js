// Shared by the tests: the project root, and the real simulation module (imported directly, exactly as the game does).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { default as Sim } from '../../src/sim/sim.js';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
