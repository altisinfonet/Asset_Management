import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { Public } from '../auth/index.js';
import { ApiProblem, ZodValidationPipe } from '../platform/index.js';
import { STORAGE_ADAPTER, StorageNotFoundError, type StorageAdapter } from '../ports/index.js';
import {
  FILE_RESPONSE_HEADERS,
  FileTokenError,
  LocalStorageAdapter,
  UploadConflictError,
  UploadSizeError,
  contentDisposition,
} from '../storage/index.js';
import { findAllowedType, normalizeMime } from './content.js';
import { tokenParam } from './schemas.js';

const tokenPipe = () => new ZodValidationPipe(tokenParam, 'params');

/**
 * `PUT|GET /v1/files/{token}`: the "presigned URL" endpoints of the LOCAL storage driver
 * (M2-FILE-01). The token is the credential (HMAC-signed, short-lived, bound to one object key and
 * one operation), so the routes are public: no cookie is read, none is set, which is what makes them
 * safe to serve from a dedicated cookie-less host (`FILES_BASE_URL`). With the S3 driver the same
 * URLs point at the object store instead and these routes answer 404.
 *
 *   PUT  accepts exactly the promised content type and byte count, streams to disk, writes once.
 *   GET  streams the object with the full header set of `storage/headers.ts` (nosniff, sandbox CSP,
 *        type from the allow-list, `attachment` unless it is a raster image).
 */
@Controller('files')
export class LocalFilesController {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  private local(): LocalStorageAdapter {
    if (!(this.storage instanceof LocalStorageAdapter)) {
      throw new ApiProblem({
        code: 'not-found',
        detail: 'This deployment stores files elsewhere.',
      });
    }
    return this.storage;
  }

  private verify(token: string, op: 'put' | 'get') {
    const local = this.local();
    try {
      const payload = local.verifyToken(token);
      if (payload.op !== op) throw new FileTokenError('malformed');
      return { local, payload };
    } catch (err) {
      if (err instanceof FileTokenError) {
        throw err.reason === 'expired'
          ? new ApiProblem({
              code: 'token-expired',
              detail: 'The upload or download link expired.',
            })
          : new ApiProblem({ code: 'token-invalid', detail: 'The link is not valid.' });
      }
      throw err;
    }
  }

  @Put(':token')
  @Public()
  @HttpCode(200)
  async upload(
    @Param('token', tokenPipe()) token: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const { local, payload } = this.verify(token, 'put');
    const sent = normalizeMime(String(req.headers['content-type'] ?? ''));
    if (sent !== normalizeMime(payload.ct)) {
      throw new ApiProblem({
        code: 'unsupported-media-type',
        detail: `The upload URL was issued for ${payload.ct}.`,
      });
    }
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) !== payload.sz) {
      throw new ApiProblem({
        code: Number(declared) > (payload.sz ?? 0) ? 'payload-too-large' : 'bad-request',
        detail: `The upload URL was issued for exactly ${payload.sz} bytes.`,
      });
    }
    try {
      await local.receive(payload, req.body as Readable);
    } catch (err) {
      if (err instanceof UploadSizeError) {
        throw new ApiProblem({
          code: err.actual === 'more' ? 'payload-too-large' : 'bad-request',
          detail: `The upload URL was issued for exactly ${err.expected} bytes.`,
        });
      }
      if (err instanceof UploadConflictError) {
        throw new ApiProblem({ code: 'conflict', detail: 'This upload URL was already used.' });
      }
      throw err;
    }
  }

  @Get(':token')
  @Public()
  async download(
    @Param('token', tokenPipe()) token: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const { local, payload } = this.verify(token, 'get');
    // The token's type must still be on the allow-list: whatever it says, nothing else is ever served.
    const type = findAllowedType(payload.ct);
    const contentType = type?.mime ?? 'application/octet-stream';
    const isDerivative = payload.k.endsWith('.thumb');
    const disposition =
      isDerivative || type?.family === 'image' ? (payload.cd ?? 'attachment') : 'attachment';

    let info;
    let stream: Readable;
    try {
      info = await local.head(payload.k);
      if (!info) throw new StorageNotFoundError(payload.k);
      stream = await local.read(payload.k);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new ApiProblem({ code: 'not-found', detail: 'The file does not exist.' });
      }
      throw err;
    }
    for (const [name, value] of Object.entries(FILE_RESPONSE_HEADERS))
      void reply.header(name, value);
    void reply.header('content-type', contentType);
    void reply.header('content-length', String(info.sizeBytes));
    void reply.header('content-disposition', contentDisposition(payload.fn ?? 'file', disposition));
    return new StreamableFile(stream);
  }
}
