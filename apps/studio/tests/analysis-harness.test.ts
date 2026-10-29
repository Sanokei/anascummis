import {test, expect} from 'bun:test';
import {runAnalysis} from '../core/analysis-harness';
import type {Infer} from '../core/model';

const signal = () => new AbortController().signal;
const source = {id: 'inspection-1', text: 'The workshop opens at 10 am on Saturdays. It is closed on Sundays.'};
const grounded = {response: 'The workshop opens at 10 am on Saturdays.', citations: [{id: source.id, quote: 'opens at 10 am on Saturdays'}], uncertainty: ''};
const answer = {response: 'Air molecules scatter shorter blue wavelengths more strongly.', citations: [], uncertainty: 'This is a general explanation rather than a measurement of your local sky.'};

test('analysis produces a useful no-source answer with an explicit factual-verification boundary', async () => {
  const infer: Infer = async (system, user, schema) => {
    expect(system).toContain('no browsing');
    expect(user).toContain('Why is the sky blue?');
    expect((schema.properties as any).response).toBeDefined();
    return answer;
  };
  const result = await runAnalysis('Why is the sky blue?', {}, signal(), infer);
  expect(result.message).toContain(answer.response);
  expect(result.message).toContain(answer.uncertainty);
  expect(result.message).toContain('no sources or current facts were independently checked');
  expect(result.verified).toBe(true);
  expect(result.evidence).toHaveLength(1);
});

test('source-backed analysis validates actual source IDs and exact excerpts without claiming truth verification', async () => {
  const result = await runAnalysis('When does the workshop open on Saturday?', {evidence: [source]}, signal(), async () => grounded);
  expect(result.message).toContain('[inspection-1]');
  expect(result.message).toContain('opens at 10 am on Saturdays');
  expect(result.message).toContain('factual accuracy has not been independently verified');
  expect(result.evidence[0]).toBe('Exact supplied-source quote [inspection-1]: opens at 10 am on Saturdays');
});

test('invented source IDs, invented quotes and missing citations fail closed', async () => {
  for (const value of [
    {...grounded, citations: [{id: 'imaginary-source', quote: 'opens at 10 am on Saturdays'}]},
    {...grounded, citations: [{id: source.id, quote: 'opens at 11 am'}]},
    {...grounded, citations: []}
  ]) await expect(runAnalysis('When does it open?', {evidence: [source]}, signal(), async () => value)).rejects.toThrow();
});

test('source-less answers cannot attach invented citations, URLs or browsing claims', async () => {
  for (const value of [
    {...answer, citations: [{id: 'a-web-page', quote: 'proof'}]},
    {...answer, response: 'See https://invented.example/sky for proof.'},
    {...answer, response: 'I searched the web and verified this answer.'},
    {...answer, uncertainty: 'I found the answer online at https://invented.example/sky.'},
    {...answer, uncertainty: ''}
  ]) await expect(runAnalysis('Why is the sky blue?', {}, signal(), async () => value)).rejects.toThrow();
});

test('malformed or empty structured answers never produce a verified result', async () => {
  for (const value of [null, {response: 'x'}, {...answer, response: '  '}, {...answer, unexpected: true}, {...answer, response: 42}]) {
    await expect(runAnalysis('Explain blue light.', {}, signal(), async () => value)).rejects.toThrow();
  }
});

test('oversized questions or evidence fail before inference instead of silently dropping content', async () => {
  let calls = 0;
  const infer: Infer = async () => {calls++; return answer;};
  await expect(runAnalysis('x'.repeat(2401), {}, signal(), infer)).rejects.toThrow('no instructions were omitted');
  await expect(runAnalysis('Summarize all of this.', {evidence: [{id: 'large-page', text: 'x'.repeat(3600)}]}, signal(), infer)).rejects.toThrow('no content was submitted');
  expect(calls).toBe(0);
});

test('the supplied evidence snapshot cannot change while inference is pending', async () => {
  const mutable = {...source};
  const result = await runAnalysis('When does it open?', {evidence: [mutable]}, signal(), async () => {
    mutable.text = 'The workshop opens at 11 am on Saturdays.';
    return grounded;
  });
  expect(result.evidence[0]).toContain('10 am');
});

test('a supported request reaches the model in full, including its final instruction', async () => {
  const request = 'Explain this: ' + 'x'.repeat(2300) + '\nFinal instruction: give one uncertainty.';
  await runAnalysis(request, {}, signal(), async (_system, packet) => {
    expect(JSON.parse(packet).request).toBe(request);
    return answer;
  });
});

test('abort stops inference before a call and discards a late generated answer', async () => {
  let calls = 0;
  const before = new AbortController(); before.abort(new Error('stopped before start'));
  await expect(runAnalysis('Explain blue light.', {}, before.signal, async () => {calls++; return answer;})).rejects.toThrow('stopped before start');
  expect(calls).toBe(0);
  const during = new AbortController();
  await expect(runAnalysis('Explain blue light.', {}, during.signal, async () => {
    during.abort(new Error('stopped during inference')); return answer;
  })).rejects.toThrow('stopped during inference');
});

test('duplicate source identifiers cannot provide ambiguous evidence', async () => {
  await expect(runAnalysis('When does it open?', {evidence: [source, {...source, text: 'Conflicting evidence.'}]}, signal(), async () => grounded)).rejects.toThrow('unique');
});
