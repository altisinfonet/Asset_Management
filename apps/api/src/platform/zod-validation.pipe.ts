import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType, z } from 'zod';
import { ApiProblem, type FieldError } from './problem.js';

/** Where the validated value comes from; decides the error `pointer` format and the status. */
export type ValidationSource = 'body' | 'query' | 'params';

const escapePointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/** zod issue code -> the stable `code` of a FieldError (`pattern` for regex failures, like the API contract). */
function fieldCode(issue: ZodError['issues'][number]): string {
  if (issue.code === 'invalid_format') {
    return (issue as { format?: string }).format === 'regex' ? 'pattern' : 'format';
  }
  return issue.code;
}

/**
 * Maps a ZodError to `errors[]`: JSON pointers into the body (`/asset_tag`, `/items/0/qty`),
 * `query:<name>` for query parameters and `path:<name>` for path parameters (pointer = first path
 * segment only, so nested query objects still point at the parameter the client sent).
 */
export function fieldErrorsFromZod(error: ZodError, source: ValidationSource): FieldError[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String);
    let pointer: string;
    if (source === 'body') pointer = path.length ? `/${path.map(escapePointer).join('/')}` : '/';
    else if (source === 'query') pointer = `query:${path[0] ?? ''}`;
    else pointer = `path:${path[0] ?? ''}`;
    return { pointer, message: issue.message, code: fieldCode(issue) };
  });
}

/**
 * Validates one controller input against a zod schema and hands the parsed (coerced, defaulted,
 * stripped) value to the handler:
 *
 *   @Post() create(@Body(new ZodValidationPipe(createAssetSchema)) dto: CreateAsset) { ... }
 *   @Get()  list(@Query(new ZodValidationPipe(listQuerySchema, 'query')) q: ListQuery) { ... }
 *
 * A body that fails is `422 validation` with `errors[]`; a malformed query or path parameter is
 * `400 bad-request` with the same `errors[]` (openapi: `BadRequest` vs `Unprocessable`).
 */
@Injectable()
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly source: ValidationSource = 'body',
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const errors = fieldErrorsFromZod(result.error, this.source);
    if (this.source === 'body') {
      throw new ApiProblem({
        code: 'validation',
        detail: `The request body failed validation (${errors.length} problem${errors.length === 1 ? '' : 's'}).`,
        errors,
      });
    }
    const first = errors[0];
    throw new ApiProblem({
      code: 'bad-request',
      detail: first
        ? `${this.source === 'query' ? 'Query' : 'Path'} parameter "${first.pointer.split(':')[1]}": ${first.message}`
        : 'Invalid parameters.',
      errors,
    });
  }
}
