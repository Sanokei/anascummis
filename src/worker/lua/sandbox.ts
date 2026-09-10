import { lua, lauxlib, lualib, to_luastring, to_jsstring, type LuaState } from 'fengari';
import { fail, ok, type Result } from '@shared/types';

/**
 * Bounded Lua execution.
 *
 * Removing library names alone is not isolation, so this sandbox additionally:
 *   - builds a fresh state per invocation and closes it afterwards;
 *   - runs the capability inside a coroutine, so a host binding suspends the
 *     VM through an explicit yield/resume protocol instead of blocking it;
 *   - installs a debug hook fired every N VM instructions that raises a Lua
 *     error past the instruction or elapsed ceiling, which interrupts a
 *     spinning loop rather than waiting on a JavaScript timer;
 *   - counts every host binding call and refuses past the ceiling;
 *   - bounds the size and depth of any value crossing the boundary.
 *
 * Lua is leaf execution. It receives validated arguments and specifically
 * granted bindings and returns bounded structured data. There is no path from
 * here to the model, to another capability, to module loading, or to a secret.
 */

export interface HostBinding {
  name: string;
  /** Resolved by the host between a yield and the matching resume. */
  call: (args: unknown[]) => Promise<unknown> | unknown;
}

export interface SandboxLimits {
  instructionLimit: number;
  timeoutMs: number;
  outputBytes: number;
  hostCalls: number;
  /** Ceiling on the number of values converted per boundary crossing. */
  maxValueNodes: number;
}

export interface SandboxRun {
  value: unknown;
  instructionsUsed: number;
  hostCallsUsed: number;
  elapsedMs: number;
}

/** Names removed from the sandbox global table before capability code runs. */
const DENIED_GLOBALS = [
  'dofile',
  'loadfile',
  'load',
  'loadstring',
  'require',
  'module',
  'package',
  'io',
  'os',
  'debug',
  'collectgarbage',
  'rawset',
  'rawget',
  'rawequal',
  'rawlen',
  'setmetatable',
  'getmetatable',
  'newproxy',
  'coroutine',
  'print',
  'dofile',
];

/** Screened before compilation. Static screening supports the boundary, it is not the boundary. */
const PROHIBITED_SOURCE: RegExp[] = [
  /\bos\s*[.[]/,
  /\bio\s*[.[]/,
  /\brequire\s*[({"']/,
  /\bload(string|file)?\s*[({"']/,
  /\bdofile\s*[({"']/,
  /\bdebug\s*[.[]/,
  /\bpackage\s*[.[]/,
  /\bsetfenv\s*\(/,
  /\bgetfenv\s*\(/,
  /\b_ENV\b/,
  /\bcollectgarbage\s*\(/,
  /\bcoroutine\s*[.[]/,
];

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  instructionLimit: 2_000_000,
  timeoutMs: 5_000,
  outputBytes: 128 * 1024,
  hostCalls: 8,
  maxValueNodes: 4_000,
};

export function screenLuaSource(source: string): Result<true> {
  if (source.length > 64 * 1024) {
    return fail('invalid-argument', 'Lua source exceeds the 64 KiB ceiling.');
  }
  for (const pattern of PROHIBITED_SOURCE) {
    if (pattern.test(source)) {
      return fail('sandbox-violation', `Prohibited construct in Lua source: ${pattern.source}`);
    }
  }
  if (!/\bfunction\s+run\s*\(/.test(source) && !/\brun\s*=\s*function\s*\(/.test(source)) {
    return fail('contract-mismatch', 'A capability must define a global function named run(args).');
  }
  return ok(true);
}

const HOOK_INTERVAL = 250;

export async function runLua(
  source: string,
  args: unknown,
  bindings: HostBinding[],
  limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
): Promise<Result<SandboxRun>> {
  const screened = screenLuaSource(source);
  if (!screened.ok) return screened;

  const startedAt = Date.now();
  const state = {
    instructions: 0,
    hostCalls: 0,
    violation: null as null | string,
    pending: null as null | { binding: HostBinding; args: unknown[] },
  };

  const L = lauxlib.luaL_newstate();
  try {
    lualib.luaL_openlibs(L);
    for (const name of DENIED_GLOBALS) {
      lua.lua_pushnil(L);
      lua.lua_setglobal(L, to_luastring(name));
    }

    installHostTable(L, bindings, state, limits);

    const loadStatus = lauxlib.luaL_loadbuffer(
      L,
      to_luastring(source),
      null,
      to_luastring('=capability'),
    );
    if (loadStatus !== lua.LUA_OK) {
      return fail('invalid-argument', `Lua compile error: ${popError(L)}`);
    }
    if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      return fail('sandbox-violation', `Lua chunk failed to load: ${popError(L)}`);
    }

    const T: LuaState = lua.lua_newthread(L);
    installHook(T, state, limits, startedAt);

    lua.lua_getglobal(T, to_luastring('run'));
    if (!lua.lua_isfunction(T, -1)) {
      return fail('contract-mismatch', 'Capability does not expose a callable run().');
    }
    const pushedArgs = jsToLua(T, args, limits.maxValueNodes);
    if (!pushedArgs.ok) return fail('invalid-argument', pushedArgs.message);

    let status = lua.lua_resume(T, null, 1);

    while (status === lua.LUA_YIELD) {
      const request = state.pending;
      state.pending = null;
      if (!request) {
        return fail('sandbox-violation', 'Capability yielded without a host request.');
      }
      if (Date.now() - startedAt > limits.timeoutMs) {
        return fail('timeout', 'Capability exceeded its time budget while waiting on a host call.');
      }

      let hostValue: unknown;
      try {
        hostValue = await request.binding.call(request.args);
      } catch (err) {
        // A failing binding surfaces inside Lua so the capability can handle it.
        hostValue = { ok: false, error: errText(err) };
      }

      const pushed = jsToLua(T, hostValue, limits.maxValueNodes);
      if (!pushed.ok) {
        return fail('contract-mismatch', `Host result cannot enter the sandbox: ${pushed.message}`);
      }
      status = lua.lua_resume(T, null, 1);
    }

    const elapsedMs = Date.now() - startedAt;

    if (status !== lua.LUA_OK) {
      const message = popError(T);
      if (state.violation === 'instruction-limit') {
        return fail('budget-exhausted', 'Capability exceeded its instruction budget.');
      }
      if (state.violation === 'timeout') {
        return fail('timeout', 'Capability exceeded its time budget.');
      }
      if (state.violation === 'host-call-limit') {
        return fail('budget-exhausted', 'Capability exceeded its host-call budget.');
      }
      return fail('sandbox-violation', `Lua runtime error: ${message}`);
    }

    const converted = luaToJs(T, -1, limits.maxValueNodes);
    if (!converted.ok) return fail('contract-mismatch', converted.message);

    const size = new TextEncoder().encode(JSON.stringify(converted.value ?? null)).length;
    if (size > limits.outputBytes) {
      return fail(
        'budget-exhausted',
        `Capability output is ${size} bytes, over the ${limits.outputBytes} ceiling.`,
      );
    }

    return ok({
      value: converted.value,
      instructionsUsed: state.instructions,
      hostCallsUsed: state.hostCalls,
      elapsedMs,
    });
  } catch (err) {
    return fail('sandbox-violation', `Sandbox aborted: ${errText(err)}`);
  } finally {
    try {
      lua.lua_close(L);
    } catch {
      /* A close failure must not mask the original error. */
    }
  }
}

type SandboxState = {
  instructions: number;
  hostCalls: number;
  violation: null | string;
  pending: null | { binding: HostBinding; args: unknown[] };
};

function installHook(T: LuaState, state: SandboxState, limits: SandboxLimits, startedAt: number): void {
  const S = T;
  lua.lua_sethook(
    S,
    () => {
      state.instructions += HOOK_INTERVAL;
      if (state.instructions > limits.instructionLimit) {
        state.violation = 'instruction-limit';
        lauxlib.luaL_error(S, to_luastring('instruction budget exhausted'));
      }
      if (Date.now() - startedAt > limits.timeoutMs) {
        state.violation = 'timeout';
        lauxlib.luaL_error(S, to_luastring('time budget exhausted'));
      }
    },
    lua.LUA_MASKCOUNT,
    HOOK_INTERVAL,
  );
}

function installHostTable(
  M: LuaState,
  bindings: HostBinding[],
  state: SandboxState,
  limits: SandboxLimits,
): void {
  lua.lua_newtable(M);
  for (const binding of bindings) {
    lua.lua_pushstring(M, to_luastring(binding.name));
    lua.lua_pushjsfunction(M, (raw: LuaState) => {
      const S = raw;
      if (state.hostCalls >= limits.hostCalls) {
        state.violation = 'host-call-limit';
        return lauxlib.luaL_error(S, to_luastring('host call budget exhausted'));
      }
      state.hostCalls += 1;
      const argc = lua.lua_gettop(S);
      const callArgs: unknown[] = [];
      for (let i = 1; i <= argc; i++) {
        const converted = luaToJs(S, i, limits.maxValueNodes);
        if (!converted.ok) {
          state.violation = 'argument-conversion';
          return lauxlib.luaL_error(S, to_luastring(converted.message));
        }
        callArgs.push(converted.value);
      }
      state.pending = { binding, args: callArgs };
      // Suspend. The host resolves the call and resumes with exactly one value.
      return lua.lua_yield(S, 0);
    });
    lua.lua_settable(M, -3);
  }
  lua.lua_setglobal(M, to_luastring('host'));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function popError(L: LuaState): string {
  const S = L;
  try {
    const raw = lua.lua_tojsstring(S, -1);
    lua.lua_pop(S, 1);
    return typeof raw === 'string' && raw.length > 0 ? raw : 'unknown Lua error';
  } catch {
    return 'unreadable Lua error';
  }
}

type Conv<T> = { ok: true; value: T } | { ok: false; message: string };

function luaToJs(L: LuaState, index: number, budget: number, depth = 0): Conv<unknown> {
  const S = L;
  if (depth > 16) return { ok: false, message: 'Lua value nested too deeply.' };
  if (budget <= 0) return { ok: false, message: 'Lua value exceeds the node ceiling.' };

  switch (lua.lua_type(S, index)) {
    case lua.LUA_TNIL:
    case lua.LUA_TNONE:
      return { ok: true, value: null };
    case lua.LUA_TBOOLEAN:
      return { ok: true, value: lua.lua_toboolean(S, index) };
    case lua.LUA_TNUMBER:
      return { ok: true, value: lua.lua_tonumber(S, index) };
    case lua.LUA_TSTRING:
      return { ok: true, value: to_jsstring(lua.lua_tostring(S, index)) };
    case lua.LUA_TTABLE:
      return tableToJs(S, index, budget, depth);
    default:
      return { ok: false, message: 'Lua returned a value that cannot cross the sandbox boundary.' };
  }
}

function tableToJs(S: LuaState, index: number, budget: number, depth: number): Conv<unknown> {
  const abs = lua.lua_absindex(S, index);
  let remaining = budget;

  const length = lua.lua_rawlen(S, abs);
  let keyCount = 0;
  lua.lua_pushnil(S);
  while (lua.lua_next(S, abs) !== 0) {
    keyCount += 1;
    lua.lua_pop(S, 1);
    if (keyCount > remaining) {
      lua.lua_pop(S, 1);
      return { ok: false, message: 'Lua table exceeds the node ceiling.' };
    }
  }

  if (length > 0 && keyCount === length) {
    const arr: unknown[] = [];
    for (let i = 1; i <= length; i++) {
      lua.lua_rawgeti(S, abs, i);
      const item = luaToJs(S, -1, remaining - 1, depth + 1);
      lua.lua_pop(S, 1);
      if (!item.ok) return item;
      remaining -= 1;
      arr.push(item.value);
    }
    return { ok: true, value: arr };
  }

  const obj: Record<string, unknown> = {};
  lua.lua_pushnil(S);
  while (lua.lua_next(S, abs) !== 0) {
    const keyType = lua.lua_type(S, -2);
    let key: string;
    if (keyType === lua.LUA_TSTRING) {
      key = to_jsstring(lua.lua_tostring(S, -2));
    } else if (keyType === lua.LUA_TNUMBER) {
      key = String(lua.lua_tonumber(S, -2));
    } else {
      lua.lua_pop(S, 2);
      return { ok: false, message: 'Lua table keys must be strings or numbers.' };
    }
    const val = luaToJs(S, -1, remaining - 1, depth + 1);
    lua.lua_pop(S, 1);
    if (!val.ok) {
      lua.lua_pop(S, 1);
      return val;
    }
    remaining -= 1;
    if (remaining <= 0) {
      lua.lua_pop(S, 1);
      return { ok: false, message: 'Lua table exceeds the node ceiling.' };
    }
    obj[key] = val.value;
  }
  return { ok: true, value: obj };
}

function jsToLua(L: LuaState, value: unknown, budget: number, depth = 0): Conv<true> {
  const S = L;
  if (depth > 16) return { ok: false, message: 'Value nested too deeply for the sandbox.' };
  if (budget <= 0) return { ok: false, message: 'Value exceeds the node ceiling.' };

  if (value === null || value === undefined) {
    lua.lua_pushnil(S);
    return { ok: true, value: true };
  }
  if (typeof value === 'boolean') {
    lua.lua_pushboolean(S, value);
    return { ok: true, value: true };
  }
  if (typeof value === 'number') {
    lua.lua_pushnumber(S, value);
    return { ok: true, value: true };
  }
  if (typeof value === 'string') {
    lua.lua_pushstring(S, to_luastring(value));
    return { ok: true, value: true };
  }
  if (Array.isArray(value)) {
    lua.lua_createtable(S, value.length, 0);
    let remaining = budget - 1;
    for (let i = 0; i < value.length; i++) {
      const pushed = jsToLua(S, value[i], remaining, depth + 1);
      if (!pushed.ok) return pushed;
      remaining -= 1;
      lua.lua_rawseti(S, -2, i + 1);
    }
    return { ok: true, value: true };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    lua.lua_createtable(S, 0, entries.length);
    let remaining = budget - 1;
    for (const [k, v] of entries) {
      lua.lua_pushstring(S, to_luastring(k));
      const pushed = jsToLua(S, v, remaining, depth + 1);
      if (!pushed.ok) return pushed;
      remaining -= 1;
      lua.lua_settable(S, -3);
    }
    return { ok: true, value: true };
  }
  return { ok: false, message: `Cannot pass a ${typeof value} into the sandbox.` };
}
