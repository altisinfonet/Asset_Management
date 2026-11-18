import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiProblem } from './problem.js';
import { fieldErrorsFromZod, ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.strictObject({
  asset_tag: z.string().min(1).regex(/^\S+$/, 'must not contain whitespace'),
  qty: z.number().int().min(1).default(1),
  items: z.array(z.strictObject({ sku: z.string() })).optional(),
  'a/b': z.string().optional(),
});

function failure(pipe: ZodValidationPipe<z.ZodType>, value: unknown): ApiProblem {
  try {
    pipe.transform(value);
  } catch (err) {
    return err as ApiProblem;
  }
  throw new Error('expected the pipe to throw');
}

describe('ZodValidationPipe', () => {
  it('returns the parsed value with defaults applied', () => {
    expect(new ZodValidationPipe(schema).transform({ asset_tag: 'A-1' })).toEqual({
      asset_tag: 'A-1',
      qty: 1,
    });
  });

  it('body: 422 validation with JSON pointers (nested paths, escaped keys, root)', () => {
    const err = failure(new ZodValidationPipe(schema), {
      asset_tag: 'has space',
      qty: 0,
      items: [{ sku: 1 }],
      'a/b': 5,
      unknown: true,
    });
    expect(err.getStatus()).toBe(422);
    expect(err.code).toBe('validation');
    const pointers = err.errors!.map((e) => e.pointer);
    expect(pointers).toEqual(
      expect.arrayContaining(['/asset_tag', '/qty', '/items/0/sku', '/a~1b', '/']),
    );
    expect(err.errors!.find((e) => e.pointer === '/asset_tag')).toEqual({
      pointer: '/asset_tag',
      message: 'must not contain whitespace',
      code: 'pattern',
    });
    expect(err.errors!.find((e) => e.pointer === '/qty')?.code).toBe('too_small');
  });

  it('body that is not an object points at the root', () => {
    const err = failure(new ZodValidationPipe(schema), undefined);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/' })]);
  });

  it('query: 400 bad-request with query:<name> pointers and a readable detail', () => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200) });
    const err = failure(new ZodValidationPipe(q, 'query'), { limit: '500' });
    expect(err.getStatus()).toBe(400);
    expect(err.code).toBe('bad-request');
    expect(err.errors).toEqual([expect.objectContaining({ pointer: 'query:limit' })]);
    expect(err.detail).toMatch(/Query parameter "limit"/);
  });

  it('params: 400 with path:<name> pointers', () => {
    const err = failure(new ZodValidationPipe(z.object({ id: z.uuid() }), 'params'), {
      id: 'nope',
    });
    expect(err.getStatus()).toBe(400);
    expect(err.errors?.[0]?.pointer).toBe('path:id');
  });

  it('fieldErrorsFromZod maps format failures to the stable `format`/`pattern` codes', () => {
    const r = z.object({ id: z.uuid(), email: z.email() }).safeParse({ id: 'x', email: 'y' });
    expect(fieldErrorsFromZod(r.error!, 'body').map((e) => e.code)).toEqual(['format', 'format']);
  });
});
