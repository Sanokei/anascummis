import {infer, modelStatus} from '../core/model';
import {objectSchema, validate} from '../core/harness';

// This deliberately uses the application's configured inference transport and
// generated values. No fixture server, forced answer enum, or model download.
const report: {status: string; model?: unknown; checks: {name: string; passed: boolean; actual?: unknown}[]; reason?: string; limitation: string} = {
  status: 'running', checks: [],
  limitation: 'Health, tokenization, constrained generation and two basic calculations only. Run test:e2e for real user-goal acceptance; this is not voice or general reasoning-quality certification.'
};
try {
  report.model = await modelStatus();
  const ready = (report.model as {ready: boolean}).ready;
  report.checks.push({name: 'Configured local runtime is reachable', passed: ready});
  if (!ready) {
    report.status = 'blocked';
    report.reason = 'No ready local AI service. Install the official model with bun run model:setup, then keep bun run model:start running. If the provider returns Domain forbidden, apply its network access through environment settings first. This check does not install or substitute a model.';
    process.exitCode = 2;
  } else {
    const schema = objectSchema({value: {type: 'integer', minimum: -1000, maximum: 1000}});
    for (const [request, expected] of [['Compute 23 plus 19.', 42], ['Compute 9 minus 14.', -5]] as const) {
      const value = await infer('Calculate the requested integer. Return only a JSON object with value.', request, schema, AbortSignal.timeout(45_000));
      validate(schema, value);
      const actual = (value as {value: number}).value;
      report.checks.push({name: request, passed: actual === expected, actual});
      if (actual !== expected) throw new Error('The local model generated an incorrect result for: ' + request);
    }
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed'; report.reason = error instanceof Error ? error.message : String(error); process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
