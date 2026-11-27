# ADR 0006: Files: storage adapter, upload pipeline, virus scanning, thumbnails and file serving

Status: PROPOSED (Claude, 2026-11-19); implements M2-FILE-01..03, M2-SEC-02 and M2-TAG-01 and needs founder sign-off like every ADR.
Date: 2026-11-19. Stories: M2-FILE-01, M2-FILE-02, M2-FILE-03, M2-SEC-02, M2-TAG-01 (and the files part of M2-SEC-01).
Inputs: `docs/03_system_architecture.md` (3 `files` module, 6.6 upload path, 7.3 adapters, self-hosted compose); ADR 0004 (ports, jobs, outbox, ids-only payloads); `apps/api/src/ports/index.ts`; `docs/engineering/data_model.md` (`app.attachment`).

## Context

Attachments (asset photos, check-in photos, repair invoices, import files, label sheets) are the first feature where untrusted bytes enter the system. Four things must hold at once: bytes never touch the API process on the hot path (presigned URLs), a file is never served before a virus scan said clean, nothing uploaded can run in the application origin, and one image runs in both editions (S3 in Cloud, MinIO or a plain directory self-hosted).

## 1. `StorageAdapter` port, two implementations (DECISION)

`STORAGE_ADAPTER` (`src/ports/index.ts`) is chosen once at boot (`STORAGE_DRIVER`, default `s3` when `S3_ENDPOINT` is set, else `local`):

- **S3** (`src/storage/s3-storage.ts`): AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, maintained by AWS; the only module allowed to import it, enforced by ESLint). Works against MinIO (path style) and AWS S3. Presigning uses a second client built for `S3_PUBLIC_ENDPOINT` (the name browsers use; SigV4 signs the host) and never connects. The upload URL signs `content-type` and `content-length`; flexible checksums are off (`WHEN_REQUIRED`) so the browser needs no extra headers.
- **Local filesystem** (`src/storage/local-storage.ts`): objects are files under `FILES_LOCAL_DIR` (a volume shared by api and worker). "Presigned" URLs are HMAC-signed, expiring tokens (`PUT|GET {FILES_BASE_URL}/v1/files/<token>`, HKDF-derived from the master key so every replica and the worker agree) served by `files/local-files.controller.ts`. The token is the credential and names one key and one operation, so those two routes are public (no cookie is read or set) and can be served from a dedicated cookie-less host. A PUT must carry exactly the promised content type and byte count and writes the object once.
- A fake (`FakeStorageAdapter`) lives with the other fakes. A contract-style e2e suite runs the whole pipeline against the local driver and, when `S3_ENDPOINT` is set, against MinIO.

**Keys** are `tenants/<tenant_id>/<yyyy>/<attachment uuid>` (the schema's CHECK from migration 0005; the backlog sketches `t/<tenant_id>/...`, the constraint wins) with the derivative `<key>.thumb`. `storage/keys.ts` parses the exact shape and **every adapter operation refuses anything else**, so traversal, upper-case, encoded or foreign-shaped keys never reach S3 or the disk. The key is never part of an API response; it appears only inside a signed URL.

## 2. Upload pipeline and polymorphic owners (DECISION)

`POST /v1/attachments` (row `pending`, presigned PUT) -> client PUT -> `POST /v1/attachments/{id}/complete` (HEAD: exact declared size, within cap; first 256 KiB sniffed against the declared type; ETag recorded; `attachment.scan` queued) -> worker scan -> `clean`. `GET /v1/attachments/{id}` returns `download_url` only for `clean`, uploaded, unarchived attachments whose object still has the recorded ETag. A rejected upload (size, content) is archived with `scan_status = error` and its object deleted; a rejected request answers 413/415/422 after the rejection is committed.

The owner is `(entity_type, entity_id)`, validated **tenant-scoped in the transaction** (`files/owners.ts`): another tenant's id does not exist under RLS. An owner type whose table is not installed yet answers 422 "not available", so accessories, repairs, imports, locations, people and assignments plug in with no change here. `AttachmentsService.linkToOwner(trx, ids, {type,id})` re-points uploaded attachments at a record created afterwards (check-in photos are uploaded against the asset, then linked to the assignment the check-in closes), in the caller's transaction, with audit. Asset and model pictures are plain nullable columns (`asset.image_attachment_id`, `asset_model.image_attachment_id`) with composite foreign keys, so a picture is always an attachment of the same tenant; the attachment must be an image of that very owner.

## 3. Allow-list, sniffing and size caps (DECISION)

`files/content.ts`: JPEG, PNG, WebP, GIF, PDF, OOXML (docx, xlsx, pptx), ODF (odt, ods, odp), legacy Office (doc, xls, ppt) and CSV. **SVG, HTML, XML, scripts, archives and `application/octet-stream` cannot be declared.** The extension must fit the declared type (`415`), and `file-type` (maintained, magic-number based) must identify the first bytes as the declared type; CSV has no magic number, so it must be NUL-free valid UTF-8 that does not start with or contain markup (`<script`, `<svg`, `<html`...). A plain zip is tolerated only where an Office container is declared (it is still scanned and only ever served as a download).

**Amendment (2026-11-27, v0.2.10, ED-40):** an attachment of kind `import_file` may also be a `.txt` or `.tsv` text file (Excel's "Unicode text" export is a UTF-16 tab-delimited `.txt`), declared as `text/csv`, `text/plain` or `text/tab-separated-values`. It is stored and served as `text/csv` and sniffed as CSV text (the import-file rules of ED-18: UTF-8, UTF-16 with a byte order mark or Windows-1252, no NUL bytes outside UTF-16, no markup). Other kinds keep `.csv` only, and `text/plain` is not on the general allow-list.

Size caps are enforced server side four times: at creation (tier cap), by the signed upload URL (exact `content-length`), at completion (HEAD size equals the declared size and is within the cap) and while scanning (the stream is metered). Tier caps (`free` 10 MiB, `starter` 25, `pro` 50, `enterprise` and `self_hosted` 100) are lowered, never raised, by `app.tenant.settings.files.max_upload_bytes` and bounded by the deployment ceiling `FILES_MAX_BYTES_CEILING`; `GET|PUT /v1/settings/files` exposes them.

## 4. Virus scanning (DECISION)

ClamAV `clamd` as its own service (`clamav` in the dev compose, ON by default; the bundle's `scan` profile is M4-BND-01), `zINSTREAM` over TCP (`src/scanner/clamd.ts`, no library: the protocol is five lines). The `attachment.scan` worker job runs inside the tenant transaction, streams the object (never buffered), and: **clean** -> `clean`, `sha256` recorded, thumbnail queued for images; **infected** -> status `infected` with the signature in `scan_detail`, audit `attachment.infected` and outbox event `attachment.infected` (payload carries `uploaded_by`; the notification module of wave 2 subscribes), then the object and thumbnail are deleted (last, so a failed delete rolls the status back and the retry scans again). A scanner outage, a timeout or clamd's size limit **rejects the job** (retry with backoff, then dead letter); it is never read as clean. A client-declared `sha256` that does not match, a size that changed or an object whose ETag changed after confirmation end as `error` and the object is deleted.

**`SCAN_REQUIRED`** (default `true`): with no scanner configured (`CLAMD_HOST` unset) an upload stays `pending` forever (the job keeps failing, visible in the dead-letter list and in the API). With `SCAN_REQUIRED=false` it is marked `clean` with `scan_detail = scan-disabled` and an `attachment.scan_skipped` audit row and outbox event (the warning); this is a documented risk for installs that cannot run ClamAV (about 1-2 GB RAM).

**Sweep** (`attachment.sweep`, scheduler producer every 5 minutes per tenant): uploads whose completion never arrived after 24 h are archived (`scan_detail = upload-abandoned`) and their object deleted; confirmed uploads still `pending` after 10 min get their scan job queued again (singleton key, idempotent).

**Replaced objects.** A presigned PUT URL stays valid until it expires, so a client could overwrite an object after confirmation. The ETag recorded at completion is verified before the scan and before every download presign; a mismatch is `object-changed` (scan) or no `download_url` (read). The local driver additionally refuses a second write to a key.

## 5. Thumbnails and EXIF (DECISION)

`sharp` (libvips; maintained, prebuilt binaries for glibc/musl) in the worker: the `attachment.thumbnail` job decodes with a pixel limit (80 Mpx) and `failOn: error`, applies the EXIF orientation, resizes to fit 320 px and **re-encodes to WebP**, which drops EXIF, GPS, ICC and XMP and neutralises payloads hidden in the original container. Derivatives never carry metadata. The original is kept byte for byte by default (asset photos may want their EXIF); the per-tenant option `strip_exif_original` re-encodes the stored original (JPEG, PNG, WebP; GIFs are left alone) and refreshes its size, `sha256` and ETag. Width and height are recorded after orientation. HEIC is not accepted (sharp's prebuilt libheif has no HEVC decoder).

## 6. File serving and security headers (DECISION)

Content type comes from the allow-list, never from the bytes or the filename; only raster images are `inline`, everything else is `attachment`; file names are sanitised (control characters, path separators, quotes and bidi overrides removed) and sent as RFC 6266/5987 `Content-Disposition`. Responses the API itself serves (local driver) carry: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and no `Set-Cookie`. A presigned S3 response can only be shaped with `response-content-type`, `response-content-disposition` and `response-cache-control` (all three are set); there the protection is the allow-list (no HTML/SVG ever reaches the store), the forced attachment disposition and the separate origin of the store. `FILES_BASE_URL` points the local driver at a dedicated cookie-less host. `src/storage/headers.ts` is the single definition and `headers.test.ts` plus the e2e suite test it.

## 7. Scan codes (M2-TAG-01) (DECISION)

`asset.label_code` (128 random bits, hex, unique per tenant, NOT NULL since migration 0005) is the public code; the QR encodes `<PUBLIC_URL>/s/<label_code>`, Code128 the tag. `GET /v1/scan/resolve` accepts the code, the whole URL (its last path segment) or the tag, answers `entity_type: 'asset'` (accessories get their own value later), 404 for unknown, foreign and out-of-scope codes alike, 401 without a credential whatever the code, and `Cache-Control: private, no-store`. **Enumeration resistance:** only misses count; a signed-in principal with `SCAN_RESOLVE_MAX_MISSES` (60) misses in a throttle window is answered 429 with `Retry-After` before any lookup until the window ends. The counters are the shared `identity.auth_throttle` rows, so replicas agree.

## Consequences

- `sharp`, `file-type` and the AWS SDK enter the image; `docker-compose.yml` gains `clamav` (always on in dev) and the api/worker environment for MinIO and clamd.
- A deployment without ClamAV must say so (`SCAN_REQUIRED=false`); the default is the safe one.
- The attachments API is usable by other modules purely by id (`entity_type`/`entity_id`, `linkToOwner`), which is what check-in photos, repair photos and label sheets use.
- The scan handler holds the worker's tenant transaction open while it streams (the wrapper's 30 s limit; a 100 MiB object scans in seconds). clamd must accept streams up to the cap: the dev compose sets `StreamMaxLength` / `MaxFileSize` to 105M (the image's default is smaller); the M4 bundle must do the same. A per-queue transaction timeout is the follow-up if a slow store ever needs more.
- Not done here (follow-ups): purging objects of long-archived attachments, ranged downloads on the local driver, per-type size caps, a malware-quarantine review UI, and the bundle's `scan` profile (M4-BND-01).
