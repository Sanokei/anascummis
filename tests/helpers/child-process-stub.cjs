/**
 * Stands in for `node:child_process` when the test pool loads fengari.
 *
 * fengari's Lua `os` library requires it at module load to back `os.execute`.
 * The deployed Worker gets the module from the runtime under nodejs_compat;
 * the pinned test runtime does not resolve it, so the import fails before any
 * test runs. See tests/helpers/tmp-stub.cjs for why these are CommonJS.
 *
 * The sandbox removes `os` from the global table before capability code runs,
 * so nothing reachable from a capability can call this. It throws rather than
 * reporting a failed command, so a route that somehow reached it would fail
 * loudly instead of looking like a command that ran and returned nothing.
 */
module.exports = {
  execSync() {
    throw new Error('Running a subprocess is not available inside the Lua sandbox.');
  },
};
