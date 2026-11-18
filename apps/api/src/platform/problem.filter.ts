import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { sqlStateOf } from '../tenancy/index.js';
import {
  ApiProblem,
  codeForStatus,
  type FieldError,
  PROBLEM_CONTENT_TYPE,
  type ProblemBody,
  type ProblemCode,
  toProblemBody,
} from './problem.js';
import { REQUEST_ID_HEADER } from './request-id.js';
import { fieldErrorsFromZod } from './zod-validation.pipe.js';

export const PROBLEM_TYPE_BASE = Symbol('PROBLEM_TYPE_BASE');

interface Rendered {
  status: number;
  body: ProblemBody;
  headers: Record<string, string>;
}

/**
 * The one place an error becomes an HTTP response (M1-PLAT-02): every failure, from a thrown
 * {@link ApiProblem} to an unknown exception, is rendered as `application/problem+json` with a
 * stable `code`, the request id and no internals (stack traces and SQL stay in the logs).
 */
@Catch()
@Injectable()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  constructor(@Inject(PROBLEM_TYPE_BASE) private readonly typeBase: string) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const requestId = request.id;

    const { status, body, headers } = this.render(exception, requestId, request.url);
    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status}: ${err.message}`,
        err.stack,
      );
    }
    void reply
      .status(status)
      .headers({ ...headers, 'content-type': PROBLEM_CONTENT_TYPE, [REQUEST_ID_HEADER]: requestId })
      .send(body);
  }

  render(exception: unknown, requestId: string, url?: string): Rendered {
    const base = this.typeBase;
    const make = (
      code: ProblemCode,
      detail?: string,
      errors?: FieldError[],
      status?: number,
      headers: Record<string, string> = {},
      extensions?: Record<string, unknown>,
    ): Rendered => ({
      status: status ?? toProblemBody(code).status,
      body: toProblemBody(code, {
        base,
        detail,
        errors,
        requestId,
        status,
        instance: url?.split('?')[0],
        extensions,
      }),
      headers,
    });

    if (exception instanceof ApiProblem) {
      return make(
        exception.code,
        exception.detail,
        exception.errors,
        exception.getStatus(),
        exception.extraHeaders,
        exception.extensions,
      );
    }
    if (exception instanceof ZodError) {
      return make(
        'validation',
        'The request failed validation.',
        fieldErrorsFromZod(exception, 'body'),
      );
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : undefined;
      return make(code, status >= 500 ? undefined : detail, undefined, status);
    }
    // Errors raised by Fastify itself (invalid JSON, body too large, wrong content type) carry a
    // numeric statusCode and an FST_ code; they are the client's fault, so report them as such.
    const fastifyStatus = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof fastifyStatus === 'number' && fastifyStatus >= 400 && fastifyStatus < 500) {
      const message = (exception as { message?: unknown }).message;
      return make(
        codeForStatus(fastifyStatus),
        typeof message === 'string' ? message : undefined,
        undefined,
        fastifyStatus,
      );
    }
    // Safety net for constraint violations nobody translated into a domain error.
    const state = sqlStateOf(exception);
    if (state === '23505' || state === '23503') {
      return make('conflict', 'The request conflicts with the current state of the resource.');
    }
    return make(
      'internal',
      'An unexpected error occurred. Quote the request id when contacting support.',
    );
  }
}
