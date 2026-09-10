/**
 * Stub for the `readline-sync` package.
 *
 * Fengari's Lua debug library requires `readline-sync` at module load to back
 * the interactive `debug.debug()` prompt. The real package calls
 * `process.binding`, which does not exist on workerd, so importing Fengari at
 * all would fail before any Lua ran.
 *
 * The sandbox removes `debug` from the global table before capability code
 * runs, and a Worker has no console to read from in any case. This throws
 * rather than returning an empty string, so a route that somehow reached it
 * fails loudly instead of silently behaving as though someone typed nothing.
 */

function unavailable(): never {
  throw new Error('Interactive input is not available inside the Lua sandbox.');
}

export const question = unavailable;
export const prompt = unavailable;
export const keyIn = unavailable;
export const questionInt = unavailable;
export const setDefaultOptions = (): void => {
  /* There is no prompt to configure. */
};

export default { question, prompt, keyIn, questionInt, setDefaultOptions };
