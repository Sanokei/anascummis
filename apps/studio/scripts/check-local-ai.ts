import {infer, modelStatus} from '../core/model';
import {objectSchema, validate} from '../core/harness';

// This deliberately uses the application's configured inference transport and
// generated values. No fixture server, forced answer enum, or model download.
const arithmeticRole = 'Calculate the arithmetic RESULT of the requested operation. The JSON value must be the result, not an echoed operand. Respect operation order and preserve the sign; subtraction can produce a negative result. Return only a JSON object with value.';
const report: {status: string; model?: unknown; checks: {name: string; passed: boolean; actual?: unknown}[]; reason?: string; limitation: string} = {
  status: 'running', checks: [],
  limitation: 'Health, tokenization, constrained generation and four basic calculations only. Run test:e2e for real user-goal acceptance; this is not voice or general reasoning-quality certification.'
};
try {
  report.model = await modelStatus();
  const ready = (report.model as {ready: boolean}).ready;
  report.checks.push({name: 'Configured local runtime is reachable', passed: ready});
  if (!ready) {
    report.status = 'blocked';
    try {
      const value = await infer(arithmeticRole, 'Compute 23 plus 19.', objectSchema({value: {type: 'integer', minimum: -1000, maximum: 1000}}), AbortSignal.timeout(15_000));
      report.checks.push({name: 'Actual application inference request despite failed health', passed: false, actual: value});
      report.status = 'failed';
    } catch (error) {
      report.checks.push({name: 'Actual application inference request', passed: false, actual: error instanceof Error ? error.message : String(error)});
    }
    report.reason = 'No ready local AI service. Install the official model with bun run model:setup, then keep bun run model:start running. If the provider returns Domain forbidden, apply its network access through environment settings first. This check does not install or substitute a model.';
    process.exitCode = report.status === 'blocked' ? 2 : 1;
  } else {
    const schema = objectSchema({value: {type: 'integer', minimum: -1000, maximum: 1000}});
    for (const [request, expected] of [['Compute 23 plus 19.', 42], ['Compute 9 minus 14.', -5], ['Compute 22 minus 30.', -8], ['Compute 7 minus 12.', -5]] as const) {
      const value = await infer(arithmeticRole, request, schema, AbortSignal.timeout(45_000));
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
