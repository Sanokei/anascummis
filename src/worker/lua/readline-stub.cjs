/**
 * Stub for the `readline-sync` package.
 *
 * Fengari's Lua debug library requires `readline-sync` at module load to back
 * the interactive `debug.debug()` prompt. The real package calls
 * `process.binding`, which does not exist on workerd, so importing Fengari at
 * all would fail before any Lua ran.
 *
 * The sandbox removes `debug` from the global table before capability code
 * runs, and a Worker has no console to read from in any case. These throw
 * rather than returning an empty string, so a route that somehow reached one
 * fails loudly instead of behaving as though someone typed nothing.
 *
 * `setDefaultOptions` is the exception and must not throw: Fengari calls it at
 * load time. CommonJS for the same reason as the tmp stub.
 */

function unavailable() {
  throw new Error('Interactive input is not available inside the Lua sandbox.');
}

module.exports = {
  question: unavailable,
  prompt: unavailable,
  keyIn: unavailable,
  questionInt: unavailable,
  setDefaultOptions() {
    /* Called by Fengari at load. There is no prompt to configure. */
  },
};
