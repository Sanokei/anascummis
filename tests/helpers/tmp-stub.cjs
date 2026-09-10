/**
 * CommonJS mirror of src/worker/lua/tmp-stub.ts, for the test runtime.
 *
 * wrangler bundles the production stub, so an ES module is fine there. The
 * test pool hands fengari to the runtime as raw CommonJS, and its `require`
 * of an ES module fails with a syntax error before any test runs, so the
 * substitution has to be CommonJS here.
 *
 * Behaviour matches the production stub: the sandbox removes `os` before any
 * capability runs, so these exist only to satisfy the import, and they throw
 * rather than returning a plausible path.
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
