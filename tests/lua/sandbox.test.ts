import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SANDBOX_LIMITS,
  runLua,
  screenLuaSource,
  type HostBinding,
  type SandboxLimits,
} from '@worker/lua/sandbox';

/**
 * Lua is leaf execution: validated arguments in, bounded data out, no route to
 * the model, another capability, module loading, or a secret. Static screening
 * supports that boundary and is not the boundary, so the runtime checks here
 * matter more than the screening ones. A spinning loop has to be interrupted
 * by the instruction hook rather than waited on, and a denied global has to be
 * absent from the running state rather than merely absent from the source.
 */

const limits = (overrides: Partial<SandboxLimits> = {}): SandboxLimits => ({
  ...DEFAULT_SANDBOX_LIMITS,
  ...overrides,
});

const run = (source: string, args: unknown = {}, bindings: HostBinding[] = [], over: Partial<SandboxLimits> = {}) =>
  runLua(source, args, bindings, limits(over));

describe('screening the source', () => {
  it('requires a run function', () => {
    const screened = screenLuaSource('local x = 1');
    expect(screened.ok).toBe(false);
    if (!screened.ok) expect(screened.kind).toBe('contract-mismatch');
  });

  it('accepts either way of declaring one', () => {
    expect(screenLuaSource('function run(args) return 1 end').ok).toBe(true);
    expect(screenLuaSource('run = function(args) return 1 end').ok).toBe(true);
  });

  it('refuses source over the size ceiling', () => {
    const huge = `function run(args) return "${'x'.repeat(70 * 1024)}" end`;
    const screened = screenLuaSource(huge);
    expect(screened.ok).toBe(false);
    if (!screened.ok) {
      expect(screened.kind).toBe('invalid-argument');
      expect(screened.message).toContain('64 KiB');
    }
  });

  it('refuses each construct that would reach outside the sandbox', () => {
    const prohibited = [
      'function run(a) return os.time() end',
      'function run(a) return io.open("/etc/passwd") end',
      'function run(a) return require("socket") end',
      'function run(a) return load("return 1") end',
      'function run(a) return loadstring("return 1") end',
      'function run(a) return dofile("x.lua") end',
      'function run(a) return debug.getinfo(1) end',
      'function run(a) return package.path end',
      'function run(a) setfenv(1, {}) end',
      'function run(a) return getfenv(1) end',
      'function run(a) return _ENV end',
      'function run(a) collectgarbage() end',
      'function run(a) return coroutine.create(run) end',
    ];
    for (const source of prohibited) {
      const screened = screenLuaSource(source);
      expect(screened.ok, source).toBe(false);
      if (!screened.ok) expect(screened.kind).toBe('sandbox-violation');
    }
  });

  it('names the construct it objected to', () => {
    const screened = screenLuaSource('function run(a) return os.time() end');
    expect(screened.ok).toBe(false);
    if (!screened.ok) expect(screened.message).toContain('Prohibited construct');
  });

  it('runs the screening before anything is compiled', async () => {
    const result = await run('function run(a) return os.time() end');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('sandbox-violation');
  });
});

describe('the running state', () => {
  it('has no dangerous global left on it, whatever the source said', async () => {
    const result = await run(`
      function run(args)
        return {
          os = type(os),
          io = type(io),
          req = type(require),
          ld = type(load),
          dbg = type(debug),
          pkg = type(package),
          co = type(coroutine),
          pr = type(print),
          smeta = type(setmetatable),
          gc = type(collectgarbage),
        }
      end
    `);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const [name, kind] of Object.entries(result.value.value as Record<string, string>)) {
        expect(kind, `${name} is still reachable`).toBe('nil');
      }
    }
  });

  it('keeps the harmless libraries a capability actually needs', async () => {
    const result = await run(`
      function run(args)
        return { s = type(string), t = type(table), m = type(math), ty = type(type) }
      end
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ s: 'table', t: 'table', m: 'table', ty: 'function' });
    }
  });

  it('does not carry state from one invocation to the next', async () => {
    const source = `
      function run(args)
        counter = (counter or 0) + 1
        return counter
      end
    `;
    const first = await run(source);
    const second = await run(source);
    expect(first.ok && first.value.value).toBe(1);
    expect(second.ok && second.value.value).toBe(1);
  });
});

describe('interrupting a spinning capability', () => {
  it('stops an infinite loop on the instruction hook rather than hanging', async () => {
    const result = await run('function run(args) while true do end end', {}, [], {
      instructionLimit: 5_000,
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('budget-exhausted');
      expect(result.message).toContain('instruction budget');
    }
  });

  it('stops a loop that is inside the instruction budget but over its time', async () => {
    const result = await run('function run(args) while true do end end', {}, [], {
      instructionLimit: 2_000_000_000,
      timeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('timeout');
  });

  it('lets a bounded loop finish', async () => {
    const result = await run(`
      function run(args)
        local total = 0
        for i = 1, 1000 do total = total + i end
        return total
      end
    `);
    expect(result.ok && result.value.value).toBe(500_500);
  });

  it('reports what the run actually used', async () => {
    const result = await run(`
      function run(args)
        local total = 0
        for i = 1, 10000 do total = total + i end
        return total
      end
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.instructionsUsed).toBeGreaterThan(0);
      expect(result.value.hostCallsUsed).toBe(0);
      expect(result.value.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('host bindings', () => {
  const echo: HostBinding = {
    name: 'echo',
    call: (args) => ({ echoed: args[0] }),
  };

  it('suspends the vm and comes back with the host value', async () => {
    const result = await run('function run(args) local r = host.echo("hi") return r.echoed end', {}, [echo]);
    expect(result.ok && result.value.value).toBe('hi');
  });

  it('resolves a binding that returns a promise', async () => {
    const slow: HostBinding = {
      name: 'slow',
      call: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { done: true };
      },
    };
    const result = await run('function run(args) return host.slow().done end', {}, [slow]);
    expect(result.ok && result.value.value).toBe(true);
  });

  it('passes the arguments the capability supplied', async () => {
    const seen: unknown[][] = [];
    const recorder: HostBinding = {
      name: 'record',
      call: (args) => {
        seen.push(args);
        return null;
      },
    };
    await run('function run(args) host.record("a", 2, true) return 1 end', {}, [recorder]);
    expect(seen).toEqual([['a', 2, true]]);
  });

  it('counts each call and refuses past the ceiling', async () => {
    const result = await run(
      'function run(args) host.echo(1) host.echo(2) host.echo(3) return 1 end',
      {},
      [echo],
      { hostCalls: 2 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('budget-exhausted');
      expect(result.message).toContain('host-call budget');
    }
  });

  it('reports the calls a successful run made', async () => {
    const result = await run('function run(args) host.echo(1) host.echo(2) return 1 end', {}, [echo]);
    expect(result.ok && result.value.hostCallsUsed).toBe(2);
  });

  it('hands a failing binding back into Lua rather than aborting the run', async () => {
    const broken: HostBinding = {
      name: 'broken',
      call: () => {
        throw new Error('upstream is down');
      },
    };
    const result = await run(
      'function run(args) local r = host.broken() return { ok = r.ok, err = r.error } end',
      {},
      [broken],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ ok: false, err: 'upstream is down' });
    }
  });

  it('exposes only the bindings it was given', async () => {
    const result = await run(
      'function run(args) return { e = type(host.echo), other = type(host.deploy) } end',
      {},
      [echo],
    );
    expect(result.ok && result.value.value).toEqual({ e: 'function', other: 'nil' });
  });

  it('gives a capability with no bindings an empty host table', async () => {
    const result = await run('function run(args) return type(host.anything) end');
    expect(result.ok && result.value.value).toBe('nil');
  });
});

describe('values crossing the boundary', () => {
  it('carries arguments in', async () => {
    const result = await run('function run(args) return { who = args.name, n = args.count + 1 } end', {
      name: 'worker',
      count: 3,
    });
    expect(result.ok && result.value.value).toEqual({ who: 'worker', n: 4 });
  });

  it('delivers a whole number as a Lua float, which shows when it is concatenated', async () => {
    // Worth knowing when writing a capability: arithmetic is unaffected, but
    // building a string out of a count produces "3.0" rather than "3".
    const result = await run('function run(args) return "n=" .. args.count end', { count: 3 });
    expect(result.ok && result.value.value).toBe('n=3.0');
  });

  it('carries a nested structure in', async () => {
    const result = await run('function run(args) return args.outer.inner[2] end', {
      outer: { inner: ['a', 'b'] },
    });
    expect(result.ok && result.value.value).toBe('b');
  });

  it('round-trips the scalar types', async () => {
    const result = await run(`
      function run(args)
        return { s = "text", n = 4.5, t = true, f = false, nothing = nil }
      end
    `);
    expect(result.ok && result.value.value).toEqual({ s: 'text', n: 4.5, t: true, f: false });
  });

  it('returns a sequence as an array', async () => {
    const result = await run('function run(args) return { "a", "b", "c" } end');
    expect(result.ok && result.value.value).toEqual(['a', 'b', 'c']);
  });

  it('returns a keyed table as an object', async () => {
    const result = await run('function run(args) return { first = 1, second = 2 } end');
    expect(result.ok && result.value.value).toEqual({ first: 1, second: 2 });
  });

  it('refuses a value that has no meaning outside Lua', async () => {
    const result = await run('function run(args) return function() return 1 end end');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('contract-mismatch');
      expect(result.message).toContain('cannot cross the sandbox boundary');
    }
  });

  it('refuses a table too large to convert', async () => {
    const result = await run(
      `
      function run(args)
        local out = {}
        for i = 1, 500 do out["key" .. i] = i end
        return out
      end
    `,
      {},
      [],
      { maxValueNodes: 50 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('node ceiling');
  });

  it('refuses output over the byte ceiling', async () => {
    const result = await run('function run(args) return string.rep("x", 5000) end', {}, [], {
      outputBytes: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('budget-exhausted');
      expect(result.message).toContain('over the 1000 ceiling');
    }
  });
});

describe('capabilities that do not work', () => {
  it('reports a compile error as a bad argument, not a sandbox breach', async () => {
    const result = await run('function run(args) return end end end');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid-argument');
      expect(result.message).toContain('compile error');
    }
  });

  it('reports source that passes screening but leaves run uncallable', async () => {
    const result = await run('function run(args) return 1 end\nrun = 5');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('contract-mismatch');
      expect(result.message).toContain('callable run()');
    }
  });

  it('reports an error raised at runtime', async () => {
    const result = await run('function run(args) error("deliberate failure") end');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('sandbox-violation');
      expect(result.message).toContain('deliberate failure');
    }
  });

  it('reports a chunk that fails while loading', async () => {
    const result = await run('error("at load time")\nfunction run(args) return 1 end');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('sandbox-violation');
  });

  it('survives a capability erroring after a host call', async () => {
    const echo: HostBinding = { name: 'echo', call: () => 'value' };
    const result = await run('function run(args) host.echo(1) error("after the call") end', {}, [echo]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('after the call');
  });
});
