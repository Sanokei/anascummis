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
 */

export function tmpNameSync(): never {
  throw new Error('Temporary files are not available inside the Lua sandbox.');
}

export function fileSync(): never {
  throw new Error('Temporary files are not available inside the Lua sandbox.');
}

export function dirSync(): never {
  throw new Error('Temporary directories are not available inside the Lua sandbox.');
}

export function setGracefulCleanup(): void {
  /* Nothing is created, so nothing needs cleaning up. */
}

export default { tmpNameSync, fileSync, dirSync, setGracefulCleanup };
