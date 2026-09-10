/**
 * Entrypoint used only by the test pool.
 *
 * A Durable Object binding pointed at the worker under test needs
 * `poolOptions.workers.main`, and the class has to be exported from whatever
 * that path resolves to. Pointing it at the real `src/worker/index.ts` would
 * drag the whole HTTP app, its routes and its provider wiring into every test
 * run, so a coordinator test would start failing for reasons that have nothing
 * to do with the coordinator. This module exports the one class the tests
 * actually exercise and nothing else.
 */
export { SessionCoordinator } from '../../src/worker/do/session-coordinator';

export default {
  fetch(): Response {
    return new Response('test entrypoint', { status: 404 });
  },
};
