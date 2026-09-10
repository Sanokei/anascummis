/**
 * Stub for node:child_process.
 *
 * Fengari's Lua `os` library requires it at module load to back `os.execute`.
 * There are no subprocesses on workerd, and a capability that could spawn one
 * would not be a sandbox. The sandbox removes `os` before capability code
 * runs; these throw so any path that reached them fails loudly.
 */

function unavailable() {
  throw new Error('Subprocesses are not available inside the Lua sandbox.');
}

module.exports = {
  execSync: unavailable,
  exec: unavailable,
  spawnSync: unavailable,
  spawn: unavailable,
};
