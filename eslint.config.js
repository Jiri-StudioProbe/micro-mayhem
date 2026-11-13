// Lint rules for the project. Run with `npm run lint`; CI runs it before the tests.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '_site/**', 'fonts/**', 'test-results/**'] },
  js.configs.recommended,
  {
    // Everything is an ES module. By default no environment globals exist, so an undefined name is an error.
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {} },
    // An empty catch is allowed: several browser calls (storage, pointer capture) may legitimately throw and the game carries on.
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] }
  },
  {
    // Tests and tools run in Node...
    files: ['tests/**/*.js', 'tools/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    // ...and their page.evaluate() callbacks run in the browser, where the game exposes its debug hook (?debug).
    files: ['tests/browser/**/*.js', 'tests/helpers/browser.js', 'tools/perf.js', 'tools/golden.mjs'],
    languageOptions: { globals: { ...globals.browser, __mm: 'readonly' } }
  },
  {
    // The browser side of the game (shell, renderer, UI, audio) arrives as modules in M0.5 to M0.7.
    // The simulation is excluded: ESLint merges the globals of every block that matches a file, so granting browser globals here
    // and "removing" them below would not work.
    files: ['src/**/*.js'],
    ignores: ['src/sim/**'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // The simulation is pure: no window, document, storage, timers, network or console, because it gets no host globals at all and
    // `no-undef` rejects them. Anything it needs is passed in. Randomness comes only from the seeded S.rng and S.fxRng (src/sim/rng.js).
    files: ['src/sim/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/render/*', '**/ui/*', '**/audio*', '**/input*', '**/profile*', '**/net/*'], message: 'The simulation must not depend on the shell.' }] }],
      'no-restricted-syntax': ['error',
        { selector: "MemberExpression[object.name='globalThis']", message: 'The simulation must not reach for globals.' },
        { selector: "Identifier[name='Date']", message: 'Use the dt the shell passes in; wall-clock time makes races unrepeatable.' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Use S.rng() (gameplay) or S.fxRng() (decoration): Math.random makes races unrepeatable.' }]
    }
  }
];
