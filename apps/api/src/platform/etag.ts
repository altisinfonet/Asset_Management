import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { problem } from './problem.js';

/**
 * Optimistic concurrency (M1-PLAT-02). Every mutable tenant row has an integer `version` bumped by
 * a database trigger; the API exposes it as a weak entity tag `W/"<version>"` on single-resource
 * GETs and on every create/update response. `PATCH`/`DELETE` require `If-Match` with that tag:
 * absent -> 428 `precondition-required`, stale -> 412 `precondition-failed`.
 */

/** The entity tag of a row version. */
export function etagFor(version: number | bigint | string): string {
  return `W/"${version}"`;
}

/** Sets the `ETag` response header. */
export function setEtag(
  reply: Pick<FastifyReply, 'header'>,
  version: number | bigint | string,
): void {
  void reply.header('etag', etagFor(version));
}

/** Parsed `If-Match` header. */
export type IfMatch =
  | { kind: 'absent' }
  /** `If-Match: *` matches any existing resource. */
  | { kind: 'any' }
  | { kind: 'versions'; versions: string[] };

const ETAG_ITEM = /^(?:W\/)?"([^"]*)"$/;

/**
 * Parses an `If-Match` (or `If-None-Match`) value: `*`, or a comma-separated list of entity tags
 * (weak `W/"7"` or strong `"7"`; this API only issues weak tags and compares the opaque value).
 * A malformed value is a 400, not a silent mismatch.
 */
export function parseIfMatch(header: string | string[] | undefined): IfMatch {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (raw === undefined || raw.trim() === '') return { kind: 'absent' };
  if (raw.trim() === '*') return { kind: 'any' };
  const versions: string[] = [];
  for (const part of raw.split(',')) {
    const m = ETAG_ITEM.exec(part.trim());
    if (!m)
      throw problem.badRequest(
        `Header "If-Match" is not an entity tag (expected W/"<version>"): ${raw.slice(0, 80)}`,
      );
    versions.push(m[1]!);
  }
  return { kind: 'versions', versions };
}

/** 428 when the header is missing (updates and deletes must say which version they saw). */
export function requireIfMatch(
  header: string | string[] | undefined,
): Exclude<IfMatch, { kind: 'absent' }> {
  const parsed = parseIfMatch(header);
  if (parsed.kind === 'absent') {
    throw problem.preconditionRequired(
      'This operation requires an If-Match header with the ETag of the version you are modifying (W/"<version>"). GET the resource to obtain it.',
    );
  }
  return parsed;
}

/** True when the precondition holds for a resource currently at `currentVersion`. */
export function ifMatchSatisfied(
  ifMatch: IfMatch,
  currentVersion: number | bigint | string,
): boolean {
  switch (ifMatch.kind) {
    case 'absent':
    case 'any':
      return true;
    case 'versions':
      return ifMatch.versions.includes(String(currentVersion));
  }
}

/** 412 when the client's version is stale. Call it with the version read inside the transaction. */
export function assertIfMatch(ifMatch: IfMatch, currentVersion: number | bigint | string): void {
  if (!ifMatchSatisfied(ifMatch, currentVersion)) {
    throw problem.preconditionFailed(
      `The resource has changed (current ETag ${etagFor(currentVersion)}). Re-read it and retry.`,
    );
  }
}

/** `If-None-Match` on a GET: true when the client's cached copy is current (answer 304). */
export function notModified(
  ifNoneMatch: string | string[] | undefined,
  currentVersion: number | bigint | string,
): boolean {
  const parsed = parseIfMatch(ifNoneMatch);
  if (parsed.kind === 'any') return true;
  return parsed.kind === 'versions' && parsed.versions.includes(String(currentVersion));
}

/**
 * Parameter decorators, so controllers declare the precondition instead of parsing headers:
 *
 *   @Patch(':id') update(@Param('id') id: string, @RequiredIfMatch() ifMatch: IfMatch, ...)
 */
export const RequiredIfMatch = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  requireIfMatch(ctx.switchToHttp().getRequest<FastifyRequest>().headers['if-match']),
);

/** Optional `If-Match` (custody operations: checked when present). */
export const OptionalIfMatch = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseIfMatch(ctx.switchToHttp().getRequest<FastifyRequest>().headers['if-match']),
);
