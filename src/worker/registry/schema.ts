import type { JsonSchema } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';

/**
 * Small structural validator for the subset of JSON Schema the registry uses.
 * Runtime validation stays mandatory because argument values usually cannot be
 * established when a story is compiled.
 */
export function validateAgainstSchema(schema: JsonSchema, value: unknown, path = '$'): Result<unknown> {
  switch (schema.type) {
    case 'null':
      return value === null ? ok(value) : typeError(path, 'null', value);

    case 'boolean':
      return typeof value === 'boolean' ? ok(value) : typeError(path, 'boolean', value);

    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return typeError(path, schema.type, value);
      if (schema.type === 'integer' && !Number.isInteger(value)) return typeError(path, 'integer', value);
      if (schema.minimum !== undefined && value < schema.minimum) {
        return fail('invalid-argument', `${path} must be at least ${schema.minimum}.`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return fail('invalid-argument', `${path} must be at most ${schema.maximum}.`);
      }
      return ok(value);
    }

    case 'string': {
      if (typeof value !== 'string') return typeError(path, 'string', value);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return fail('invalid-argument', `${path} is longer than ${schema.maxLength} characters.`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return fail('invalid-argument', `${path} must be one of: ${schema.enum.join(', ')}.`);
      }
      return ok(value);
    }

    case 'array': {
      if (!Array.isArray(value)) return typeError(path, 'array', value);
      if (!schema.items) return ok(value);
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const item = validateAgainstSchema(schema.items, value[i], `${path}[${i}]`);
        if (!item.ok) return item;
        out.push(item.value);
      }
      return ok(out);
    }

    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return typeError(path, 'object', value);
      }
      const record = value as Record<string, unknown>;
      const props = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!(key in record)) return fail('invalid-argument', `${path}.${key} is required.`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in props)) return fail('invalid-argument', `${path}.${key} is not an accepted property.`);
        }
      }
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(props)) {
        if (!(key in record)) continue;
        const checked = validateAgainstSchema(sub, record[key], `${path}.${key}`);
        if (!checked.ok) return checked;
        out[key] = checked.value;
      }
      if (schema.additionalProperties !== false) {
        for (const [key, v] of Object.entries(record)) if (!(key in out)) out[key] = v;
      }
      return ok(out);
    }

    default:
      return fail('contract-mismatch', `Unsupported schema type at ${path}.`);
  }
}

function typeError(path: string, expected: string, value: unknown) {
  return fail('invalid-argument', `${path} must be ${expected}, received ${describe(value)}.`);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Rough byte size of a serialized result, used for output ceilings. */
export function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
