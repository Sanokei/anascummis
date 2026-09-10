/**
 * Stub for the `tmp` package.
 *
 * Fengari's Lua `os` library requires `tmp` at module load to back
 * `os.tmpname()`. The real package calls `process.binding`, which does not
 * exist on workerd, so importing Fengari at all would fail before any Lua ran.
 *
 * The sandbox removes `os` from the global table before capability code runs,
 * so nothing can reach `os.tmpname()`. This stub therefore only has to exist,
 * and it throws rather than returning a plausible path, so a route that did
 * somehow reach it would fail loudly instead of writing somewhere unexpected.
 *
 * CommonJS on purpose. The Worker build and the test runner both alias `tmp`
 * here, and the test runtime hands Fengari to the runtime as raw CommonJS,
 * whose `require` of an ES module throws before any test runs. Keeping one
 * file for both is what stops the two drifting apart.
 */

function unavailable() {
  throw new Error('Temporary files are not available inside the Lua sandbox.');
}

module.exports = {
  tmpNameSync: unavailable,
  fileSync: unavailable,
  dirSync: unavailable,
  setGracefulCleanup() {
    /* Nothing is created, so nothing needs cleaning up. */
  },
};
