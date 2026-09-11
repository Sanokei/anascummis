/**
 * Probes the live provider for what the reply path cannot learn from docs.
 *
 * Three questions are open before any of the skeleton work can be designed on
 * top of them:
 *
 *   1. Can thinking be turned off, and does turning it off buy a faster first
 *      visible token? The reply path currently sends no thinking field at all,
 *      so the provider default applies, and nothing in the codebase can express
 *      "off" — see buildDeepseekBody in src/worker/providers/model.ts.
 *   2. Does chat prefix completion accept thinking and tools? The docs mark FIM
 *      non-thinking-only and say nothing either way about prefix completion.
 *      If prefix completion cannot carry tools, a prefix pass can only ever be
 *      the phrasing half of a turn, never the tool-calling half.
 *   3. Does FIM behave on the beta surface at the sizes this would actually
 *      use — a short middle between two pinned ends?
 *
 * A fourth probe measures the context cache, because the speculative-prefill
 * design assumes a byte-stable prefix is nearly free. That assumption is
 * load-bearing and cheap to check.
 *
 * Every request here is synthetic. No story text, no personality text and no
 * user content is sent: a probe that leaks the thing it is meant to protect
 * would be worse than no probe.
 *
 *   node scripts/probe-deepseek.mjs
 *
 * Reads DEEPSEEK_API_KEY from .dev.vars, then from the environment, so a key
 * exported in the shell wins over the file.
 */
import { readFileSync } from 'node:fs';

const TIMEOUT_MS = 60_000;
const BODY_SNIPPET = 300;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** `.dev.vars` is KEY=VALUE with `#` comments; the shell overrides it. */
function loadConfig() {
  const config = {};
  try {
    for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      config[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // No .dev.vars is a normal state, not a failure: the environment may hold
    // everything this probe needs.
  }
  for (const key of Object.keys(process.env)) {
    if (process.env[key]) config[key] = process.env[key];
  }
  return config;
}

const config = loadConfig();
const apiKey = config.DEEPSEEK_API_KEY;
const model = config.DEEPSEEK_MODEL || 'deepseek-flash';

if (!apiKey) {
  console.error(
    [
      'No DEEPSEEK_API_KEY is set, so there is nothing to probe.',
      '',
      'Locally it is a wrangler secret rather than a .dev.vars entry, which is',
      'why it is missing. Add this line to .dev.vars (it is gitignored):',
      '',
      '    DEEPSEEK_API_KEY=sk-...',
      '',
      'or run this once with the key exported in the shell:',
      '',
      '    DEEPSEEK_API_KEY=sk-... node scripts/probe-deepseek.mjs',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const baseUrl = (config.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');

/**
 * The beta surface. The docs say to point the client at `/beta` rather than
 * `/v1`, and this deployment configures the OpenAI-shaped `/v1` path, so the
 * sibling is derived rather than assumed — and can be overridden outright if
 * the provider moves it.
 */
function deriveBeta(url) {
  if (config.DEEPSEEK_BASE_URL_BETA) return config.DEEPSEEK_BASE_URL_BETA.replace(/\/+$/, '');
  if (/\/v1$/.test(url)) return url.replace(/\/v1$/, '/beta');
  return `${url}/beta`;
}
const betaUrl = deriveBeta(baseUrl);

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * fetch with a retry, for connection-level failures only.
 *
 * The provider is reached over a link that intermittently fails to complete a
 * handshake inside undici's ten-second connect budget — seen twice, both times
 * on the *first* request of a run, while curl and the next Node request both
 * went through. An HTTP error is an answer and is never retried; failing to
 * connect is not an answer, and a ten-probe run should not die on the first one.
 */
async function request(url, init, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      const code = err?.cause?.code ?? err?.code;
      const transient = code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND';
      if (!transient || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

/**
 * A streaming chat call, instrumented.
 *
 * The measurement that matters is the gap between sending the request and the
 * first *content* delta — not the first delta of any kind. A reasoning delta
 * arriving early is the model thinking out loud, which is exactly the stretch
 * of wall clock this probe exists to price.
 */
async function chat({ url, label, messages, extra = {}, stream = true }) {
  const started = performance.now();
  const result = { label, firstContentMs: null, firstReasonMs: null, totalMs: null, text: '', reasoning: '', usage: null };

  const body = {
    model,
    messages,
    temperature: 0.6,
    max_tokens: 200,
    ...extra,
  };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  let res;
  try {
    res = await request(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // A probe that cannot reach the provider reports that and the run carries
    // on; one dead request should not cost the other nine their answers.
    return { ...result, error: String(err?.cause?.code ?? err) };
  }

  if (!res.ok) {
    return { ...result, error: `HTTP ${res.status}: ${(await res.text()).slice(0, BODY_SNIPPET)}` };
  }

  if (!stream) {
    const parsed = await res.json();
    result.totalMs = Math.round(performance.now() - started);
    result.text = parsed.choices?.[0]?.message?.content ?? '';
    result.reasoning = parsed.choices?.[0]?.message?.reasoning_content ?? '';
    result.usage = parsed.usage ?? null;
    return result;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let record;
    try {
      record = JSON.parse(data);
    } catch {
      return;
    }
    const choice = record.choices?.[0];
    if (record.usage) result.usage = record.usage;
    if (!choice) return;
    const delta = choice.delta ?? {};
    // Every spelling the provider has used for visible reasoning.
    const reasoned = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
    if (reasoned) {
      if (result.firstReasonMs === null) result.firstReasonMs = Math.round(performance.now() - started);
      result.reasoning += reasoned;
    }
    if (typeof delta.content === 'string' && delta.content) {
      if (result.firstContentMs === null) result.firstContentMs = Math.round(performance.now() - started);
      result.text += delta.content;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      consume(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);

  result.totalMs = Math.round(performance.now() - started);
  return result;
}

/** Fill-in-the-middle on the beta surface: prompt and suffix, model writes between. */
async function fim({ label, prompt, suffix, maxTokens = 80 }) {
  const started = performance.now();
  const body = { model, prompt, suffix, max_tokens: maxTokens, stream: false };
  let res;
  try {
    res = await request(`${betaUrl}/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { label, error: String(err) };
  }
  if (!res.ok) return { label, error: `HTTP ${res.status}: ${(await res.text()).slice(0, BODY_SNIPPET)}` };
  const parsed = await res.json();
  return {
    label,
    totalMs: Math.round(performance.now() - started),
    text: parsed.choices?.[0]?.text ?? '',
    usage: parsed.usage ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

const SHORT_MESSAGES = [
  { role: 'system', content: 'You are a terse assistant. One sentence per reply, nothing else.' },
  { role: 'user', content: 'What is a lighthouse for?' },
];

const probes = [];
// The descriptive label wins over the terse one the transport functions carry,
// so `record` spreads first rather than last.
const record = (id, label, value) => {
  probes.push({ ...value, id, label });
  return value;
};

/* A. Thinking modes. The reply path sends no field at all today. */
record('A1', 'default (no thinking field)', await chat({ url: baseUrl, label: 'A1', messages: SHORT_MESSAGES }));
record('A2', 'thinking:{type:disabled}', await chat({ url: baseUrl, label: 'A2', messages: SHORT_MESSAGES, extra: { thinking: { type: 'disabled' } } }));
record('A3', 'enabled+effort:none (what the code emits today)', await chat({ url: baseUrl, label: 'A3', messages: SHORT_MESSAGES, extra: { thinking: { type: 'enabled' }, reasoning_effort: 'none' } }));
record('A4', 'enabled+effort:high (a hard turn)', await chat({ url: baseUrl, label: 'A4', messages: SHORT_MESSAGES, extra: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } }));

/* A5–A7 once sent deliberately invalid values, because a validation error on a
   field like this enumerates what is allowed, which is cheaper than guessing at
   spellings. That is settled now, so these probe what the vocabulary revealed:
   `thinking.type` accepts `adaptive`, which is provider-side self-selection —
   the thing this project actually wants.

   Harvested 2026-09-11 (from those 400s, which is why the requests were wrong):
     reasoning_effort: none | minimal | low | medium | high | xhigh | max
     thinking.type:    adaptive | enabled | disabled

   `adaptive` is paired with an easy question and a hard one on purpose: the
   only way to tell self-selection from a fixed default is to see it choose
   differently for the two. */
const HARD_MESSAGES = [
  { role: 'system', content: 'You are a careful assistant. Reply with only the final number.' },
  {
    role: 'user',
    content:
      'A crate holds 24 boxes, a box holds 18 tins, and a tin holds 12 biscuits. How many biscuits are in 7 crates, less the 3 tins that were opened?',
  },
];

record('A5', 'adaptive · easy question', await chat({ url: baseUrl, label: 'A5', messages: SHORT_MESSAGES, extra: { thinking: { type: 'adaptive' } } }));
record('A6', 'adaptive · hard question', await chat({ url: baseUrl, label: 'A6', messages: HARD_MESSAGES, extra: { thinking: { type: 'adaptive' } } }));
record('A7', 'adaptive + effort:high · hard question', await chat({ url: baseUrl, label: 'A7', messages: HARD_MESSAGES, extra: { thinking: { type: 'adaptive' }, reasoning_effort: 'high' } }));

/* B. Prefix completion. Does the model continue a pinned opening, and can that
   pass carry thinking or tools? */
const PREFIX_MESSAGES = [
  { role: 'system', content: 'You are a terse assistant. One sentence per reply, nothing else.' },
  { role: 'user', content: 'What is a lighthouse for?' },
  { role: 'assistant', content: 'A lighthouse ', prefix: true },
];
record('B1', 'prefix completion at /beta', await chat({ url: betaUrl, label: 'B1', messages: PREFIX_MESSAGES }));
record('B2', 'prefix + thinking enabled', await chat({ url: betaUrl, label: 'B2', messages: PREFIX_MESSAGES, extra: { thinking: { type: 'enabled' }, reasoning_effort: 'low' } }));
record('B3', 'prefix + tools', await chat({
  url: betaUrl,
  label: 'B3',
  messages: PREFIX_MESSAGES,
  extra: {
    tools: [{
      type: 'function',
      function: {
        name: 'noop',
        description: 'Does nothing. Present to test whether a prefix pass tolerates tools.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }],
  },
}));
/* B3 failed on `reasoning_content`, not on tools: it inherited the thinking
   default, and a thinking-mode request with an assistant message demands that
   message carry its reasoning back. B3b is the same request with the default
   overridden, which separates "tools are not allowed here" from "thinking and a
   prefilled assistant turn do not mix". */
record('B3b', 'prefix + tools + thinking:disabled', await chat({
  url: betaUrl,
  label: 'B3b',
  messages: PREFIX_MESSAGES,
  extra: {
    thinking: { type: 'disabled' },
    tools: [{
      type: 'function',
      function: {
        name: 'noop',
        description: 'Does nothing. Present to test whether a prefix pass tolerates tools.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }],
  },
}));

/* C. FIM, at the size a beat-fill would actually use. */
record('C1', 'FIM between two pinned ends', await fim({
  label: 'C1',
  prompt: 'The harbour was quiet that morning: boats still tied, gulls arguing over nothing, and',
  suffix: 'then she closed the notebook and went inside.',
}));

/* D. Context cache. The speculative-prefill design assumes a byte-stable
   prefix is nearly free, so this measures whether a repeat actually hits. */
const STABLE_PREFIX = Array.from(
  { length: 40 },
  () => 'The assistant answers plainly, states what it knows, and does not pad a reply to sound thorough.',
).join(' ');
const cacheMessages = [
  { role: 'system', content: STABLE_PREFIX },
  { role: 'user', content: 'Say the word "ready".' },
];
record('D1', 'cache: first call (cold)', await chat({ url: baseUrl, label: 'D1', messages: cacheMessages, stream: false }));
record('D2', 'cache: identical second call', await chat({ url: baseUrl, label: 'D2', messages: cacheMessages, stream: false }));

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

console.log(`\nAnascummis · DeepSeek probe`);
console.log(`  model  ${model}`);
console.log(`  base   ${baseUrl}`);
console.log(`  beta   ${betaUrl}`);
console.log(`  runs   ${new Date().toISOString()}\n`);

for (const probe of probes) {
  const head = `${probe.id}  ${probe.label}`;
  if (probe.error) {
    console.log(`${head}\n     FAILED  ${probe.error}\n`);
    continue;
  }
  const timing = [
    probe.firstContentMs !== null && probe.firstContentMs !== undefined ? `first content ${probe.firstContentMs}ms` : null,
    probe.firstReasonMs ? `first reasoning ${probe.firstReasonMs}ms` : null,
    probe.totalMs !== null && probe.totalMs !== undefined ? `total ${probe.totalMs}ms` : null,
  ].filter(Boolean).join('   ');
  console.log(head);
  console.log(`     ${timing}`);
  if (probe.usage) {
    const u = probe.usage;
    const cache = u.prompt_cache_hit_tokens !== undefined
      ? `  cache hit ${u.prompt_cache_hit_tokens}/${u.prompt_tokens}`
      : '';
    console.log(`     tokens  prompt ${u.prompt_tokens}  completion ${u.completion_tokens}${cache}`);
  }
  const shown = (probe.text ?? '').replace(/\s+/g, ' ').trim();
  if (shown) console.log(`     text    ${JSON.stringify(shown.slice(0, 160))}`);
  const thought = (probe.reasoning ?? '').replace(/\s+/g, ' ').trim();
  if (thought) console.log(`     thought ${JSON.stringify(thought.slice(0, 120))}`);
  console.log('');
}
