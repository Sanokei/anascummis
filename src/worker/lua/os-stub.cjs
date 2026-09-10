/**
 * Stub for node:os.
 *
 * Fengari calls `require('os').platform()` at module load: its first branch is
 * `typeof process === "undefined"`, and `process` is defined under
 * `nodejs_compat`, so it takes the Node path.
 *
 * The value only picks Lua's directory separator and its module search paths.
 * The sandbox nils out `package` and `require`, so nothing observable to a
 * capability depends on which platform this claims to be.
 */

module.exports = {
  platform() {
    return 'linux';
  },
  EOL: '\n',
  tmpdir() {
    throw new Error('There is no filesystem inside the Lua sandbox.');
  },
};
