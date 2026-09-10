/**
 * CommonJS mirror of src/worker/lua/readline-stub.ts, for the test runtime.
 * See tests/helpers/tmp-stub.cjs for why a CommonJS copy is needed.
 *
 * `setDefaultOptions` is called by fengari's debug library at module load, so
 * it has to work. Everything else throws, matching the production stub: the
 * sandbox removes `debug` before any capability runs.
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
    /* There is no prompt to configure. */
  },
};
