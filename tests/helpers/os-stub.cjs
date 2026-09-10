/**
 * Stands in for `node:os` when the test pool loads fengari.
 *
 * fengari's luaconf falls through to `require('os').platform()` whenever
 * `process` is defined, which it is under nodejs_compat, so importing the
 * sandbox pulls the module in. The deployed Worker gets it from the runtime;
 * the pinned test runtime does not resolve it and the import fails outright.
 *
 * The only thing the return value decides is Lua's directory separator and its
 * module search paths, and the sandbox nils out `package` and `require` before
 * any capability runs, so nothing reachable from a test can observe it. It
 * reports a non-Windows platform, which is what the deployed Worker sees.
 *
 * CommonJS on purpose: fengari is a CommonJS package and `require`s this.
 */
module.exports = {
  platform() {
    return 'linux';
  },
};
