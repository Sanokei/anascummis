/**
 * Minimal ambient types for Fengari.
 *
 * Fengari ships no type declarations. Rather than pull the whole Lua C API in
 * as `any`, this declares only the surface the sandbox actually uses, so a
 * typo in an API name is still a compile error.
 */
declare module 'fengari' {
  /** Opaque Lua state or thread handle. */
  export type LuaState = { readonly __lua: unique symbol };

  export const lua: {
    readonly LUA_OK: number;
    readonly LUA_YIELD: number;
    readonly LUA_MASKCOUNT: number;
    readonly LUA_TNONE: number;
    readonly LUA_TNIL: number;
    readonly LUA_TBOOLEAN: number;
    readonly LUA_TNUMBER: number;
    readonly LUA_TSTRING: number;
    readonly LUA_TTABLE: number;

    lua_close(L: LuaState): void;
    lua_newthread(L: LuaState): LuaState;
    lua_resume(L: LuaState, from: LuaState | null, nargs: number): number;
    lua_yield(L: LuaState, nresults: number): number;
    lua_pcall(L: LuaState, nargs: number, nresults: number, errfunc: number): number;
    lua_sethook(L: LuaState, hook: () => void, mask: number, count: number): void;

    lua_gettop(L: LuaState): number;
    lua_absindex(L: LuaState, index: number): number;
    lua_pop(L: LuaState, n: number): void;
    lua_type(L: LuaState, index: number): number;
    lua_isfunction(L: LuaState, index: number): boolean;

    lua_pushnil(L: LuaState): void;
    lua_pushboolean(L: LuaState, value: boolean): void;
    lua_pushnumber(L: LuaState, value: number): void;
    lua_pushstring(L: LuaState, value: Uint8Array): void;
    lua_pushjsfunction(L: LuaState, fn: (L: LuaState) => number): void;

    lua_toboolean(L: LuaState, index: number): boolean;
    lua_tonumber(L: LuaState, index: number): number;
    lua_tostring(L: LuaState, index: number): Uint8Array;
    lua_tojsstring(L: LuaState, index: number): string;

    lua_newtable(L: LuaState): void;
    lua_createtable(L: LuaState, narr: number, nrec: number): void;
    lua_settable(L: LuaState, index: number): void;
    lua_next(L: LuaState, index: number): number;
    lua_rawlen(L: LuaState, index: number): number;
    lua_rawgeti(L: LuaState, index: number, n: number): number;
    lua_rawseti(L: LuaState, index: number, n: number): void;
    lua_getglobal(L: LuaState, name: Uint8Array): number;
    lua_setglobal(L: LuaState, name: Uint8Array): void;
  };

  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadbuffer(L: LuaState, buff: Uint8Array, size: number | null, name: Uint8Array): number;
    luaL_error(L: LuaState, message: Uint8Array): number;
  };

  export const lualib: {
    luaL_openlibs(L: LuaState): void;
  };

  export function to_luastring(value: string, cache?: boolean): Uint8Array;
  export function to_jsstring(value: Uint8Array): string;
}
