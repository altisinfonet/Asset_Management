# ADR 0007: Label rendering: pure-JS PDF and barcode libraries, fixed templates, asynchronous batches

Status: PROPOSED (Claude, 2026-11-19); implements M2-TAG-02 and needs founder sign-off like every ADR.
Date: 2026-11-19. Stories: M2-TAG-02 (the API half of M2-TAG-03; M2-TAG-04 is the founder's print calibration).
Inputs: `docs/05_backlog.md` (E2.7), `docs/design/wireframes.md` WEB-15, `docs/engineering/data_model.md` (`label_template`), ADR 0004 (ports, jobs, outbox), ADR 0006 (storage adapter, scan codes, `label_code`).

## Context

A label sheet has to do four things at once: be rendered off the request path (500 labels in under 30 s), contain codes a USB wedge scanner and a phone camera read first time, land in the right slot of a partly used sheet, and leave no trace in the web tier (no headless browser, no native toolchain in the image, no per-label bitmap). The template editor is out (v1.1): the templates are constants.

## 1. Libraries (DECISION)

- **`pdfkit` 0.20.2** writes the PDF. Pure JS, maintained (the last release is from this month), streams, vector drawing, the 14 standard fonts need no embedding. Rejected: `pdf-lib` (unmaintained since 2021, no text measuring), `jsPDF` (browser first, heavier), Puppeteer/Playwright (a headless browser in the worker image is exactly what we avoid; 10 to 100 times slower per page).
- **`bwip-js` 4.11.4** encodes both symbologies: `bwipjs.raw('qrcode', url, 'eclevel=M')` returns the module matrix, `bwipjs.raw('code128', tag)` the bar and space widths. Pure JS, maintained, one dependency for QR and Code128 (the backlog's "bwip-js or equivalent"). It is used only as an encoder: the codes are drawn by the renderer itself as **vector rectangles** (one path per symbol), never as bitmaps, so they print at the printer's native resolution and a 500-label PDF stays under 1 MiB. QR error correction M (15 %): a scuffed label still reads.
- Only `src/tagging` imports either library (`tagging/boundaries.test.ts`).

Test-side only (devDependencies): `pdfjs-dist` parses and **rasterises** the PDF on `@napi-rs/canvas` (prebuilt binaries, no system libraries), `jsqr` decodes QR codes from the bitmap, `@zxing/library` decodes Code128. **Finding:** ZXing-js fails to decode about 1 valid QR symbol in 10 (200 random label URLs, two independent encoders, bwip-js and node-qrcode: ZXing 184 and 181 decodes, jsQR 200 and 200), so jsQR is the judge for QR and ZXing only reads Code128. Production decoders (iOS, Android camera, USB wedge) are not these libraries; the founder's print test (M2-TAG-04) remains the real scannability check.

## 2. Templates are constants, rows are seeded (DECISION)

`tagging/templates.ts` holds the geometry; migration 0070 seeds the same values per tenant; `test/tagging/labels.e2e.test.ts` fails when a seeded row and a constant disagree, and `render.test.ts` snapshot-compares the geometry. Six templates: Letter 30-up (Avery 5160), A4 21-up (L7160), **A4 24-up 3 x 8 (L7159, added: the backlog asks for "A4 3x8")**, Letter 10-up (5163), 50 x 25 mm single, **2 x 1 inch single for thermal printers (added)**. The 5163 grid of the first draft in `schema.sql` was wrong (no column gap, 4.00 mm margin); it is now 3.97 mm margin and 4.76 mm gap, which fills the page. Every grid is arithmetically checked by the table's CHECKs, but **die lines are unverified until the founder prints them** (M2-TAG-04): the two columns `offset_x_mm` / `offset_y_mm` (+-10 mm) shift a whole sheet and are the only fields `PATCH /v1/labels/templates/{id}` changes (`catalog:manage`, `If-Match`, audited). Reporting the calibration back is "set the offsets", not a code change.

**Seeding is a separate step.** `app.seed_label_templates(tenant_id)` is idempotent (`ON CONFLICT DO NOTHING`) and refuses unless `app.tenant_id` is the tenant. It is called by `bootstrapTenant`, by migration 0070 for every existing tenant, and lazily by the labels service, so a tenant provisioned through any other path still gets its templates on first use. `app.provision_tenant` was **not** replaced (other M2 branches own seeds in it); migration 0011 stays its latest definition.

## 3. Asynchronous batches (DECISION)

`POST /v1/labels/batches` (permission `asset:label`, `Idempotency-Key` required) answers `202` with a `LabelBatch` and enqueues `label.render` (payload: `tenantId`, `batchId`, ids only) in the same transaction as the batch row and the audit row. The assets come from explicit `asset_ids` (their order is the print order) or from the **list filter** of `GET /v1/assets` (the same schema and WHERE clause, through the registry facade, default order by tag), resolved at request time and stored as the batch's `asset_ids`. Options: `template_key`, `start_position` on the first sheet (1-based, row by row, at most the template's slot count), `copies` (1 to 10, next to each other), `codes` (`qr`, `code128`, default from the template), `fields` (`asset_tag`, `name`, `serial`, `location`, `model`, `organisation`; the first line is the largest), optional `logo_attachment_id` (a clean PNG or JPEG of the tenant, at most 2 MiB, re-encoded to a small non-interlaced PNG by sharp), `outlines` (hairline around each label: calibration on plain paper).

Limits, all checked before anything is queued: 2000 assets and 2000 labels (assets x copies) per batch (measured below), every asset must exist in the tenant, a Code128 needs printable-ASCII tags and a module of at least 0.17 mm on the template (`barcode-unprintable` otherwise: use the QR or a wider template), `start_position` within the slots. The QR encodes `<WEB_BASE_URL>/s/<label_code>` (ADR 0006: opaque, no internal id) and the Code128 the asset tag.

`GET /v1/labels/batches/{id}` is the polling endpoint (`queued`, `ready`, `failed`, `expired`) and, when ready, returns a fresh presigned `download_url` (a few minutes, `FILES_DOWNLOAD_URL_TTL_SECONDS`, `Content-Disposition: attachment`, content type forced to `application/pdf`). `GET /v1/labels/batches` lists the caller's batches (cursor, status filter). **A batch is private to the user or API key that requested it**; another user of the same tenant, a tenant admin included, gets `404`. The object key never appears in the API.

**Not an `app.attachment`.** The backlog says "written as an attachment". The PDF is stored through the StorageAdapter under the usual tenant-prefixed key (`tenants/<tenant>/<yyyy>/<batch id>`, the key is derived from the batch so a retry overwrites), but its metadata lives on `label_batch` (`storage_key`, `size_bytes`, `sha256`, CHECKs: tenant prefix, `ready` needs a file). Reason: attachments hang off an owner (`entity_type` is a closed list that every parallel branch edits), go through the upload cap and the virus scan (server-generated bytes need neither), and are never expired. Expiry is `label.sweep`.

## 4. The worker job (DECISION)

`label.render` (queue `label.render`, interactive, 3 retries) runs in the tenant transaction like every handler, with a **per-queue transaction limit of 2 minutes** (`QueueDefinition.transactionTimeoutSeconds`, new, default stays 30 s; the 2000-label worst case takes about 9 s, the limit is headroom for slow hosts). It: locks the batch row (a retry racing a slow first attempt is serialised), loads template, tenant name and assets, renders, writes the object, flips the row to `ready` (size, sha256, pages, `render_ms`), inserts one `asset_history` row of type `label_printed` per asset (one statement; actor = requester; this is the "reprint history per asset", read through `GET /v1/assets/{id}/history?event_type=label_printed`), audits and publishes the outbox event **`label.batch.ready`** with ids only (`batch_id`, `requested_by`, `version`); the notification module subscribes later. Failure handling: input that can never render (`LabelRenderError`: unreadable logo, vanished template) fails the batch at once without retries; any other error is retried by the queue with backoff, and on the last attempt the batch becomes `failed` (`error.code = render-failed`) with the event `label.batch.failed`. The render runs inside a savepoint, so a failure cannot poison the transaction that records it.

`label.sweep` (scheduler producer, every 10 minutes per tenant): deletes the file of a `ready` batch past `expires_at` (7 days; status `expired`, audited) and queues `label.render` again for a batch still `queued` after 10 minutes (the job was lost; a singleton key makes it idempotent).

## 5. Layout and text (DECISION)

Padding is 6 % of the label height (1 to 2 mm). A QR square sits on the left (at most 45 % of the width and the content height, quiet zone of 2 modules inside the square); the right column holds, top to bottom, the optional logo (at most 30 % of the height), the text lines and the Code128 bars (at most 34 % of the height, 10 modules of quiet zone each side). Without a QR the column spans the label. Text: line 1 Helvetica-Bold 11 pt, the others Helvetica 8 pt; all lines shrink together to the available height, each line then shrinks to its width down to 4.5 pt, and what still does not fit is cut with an ellipsis; when even that leaves no room the lowest-priority lines are dropped. **Limit:** the standard fonts are WinAnsi; characters outside it print as `?`. Embedding a Unicode font is the follow-up when a customer needs CJK or Cyrillic on labels (the tag is printable in the QR whatever the font).

## 6. Measured (this repo, Windows host, Node 24, local storage driver)

| Batch | Pages | PDF | Worker job (load, render, store, DB writes) |
|---|---|---|---|
| 500 labels, Letter 30-up, QR + Code128 | 17 | 887 KiB | **2.0 s** (target < 30 s) |
| 2000 labels, Letter 10-up, QR + Code128 | 200 | 3.1 MiB | 8.6 s |

Sampled pages of the 500-label PDF are rasterised at 300 dpi and every QR and Code128 on them decoded back to the asset's code and tag (`labels.e2e.test.ts`).

## Consequences

- New dependencies in the API image: `pdfkit`, `bwip-js` (runtime), `pdfjs-dist`, `@napi-rs/canvas`, `@zxing/library`, `jsqr`, `@types/pdfkit` (dev). pdfkit reads its font metrics from files inside its package: the production image must keep `node_modules/pdfkit` (it does: `pnpm deploy`).
- New contract operations (tag Labels): `listLabelTemplates`, `getLabelTemplate`, `updateLabelTemplate`, `createLabelBatch`, `listLabelBatches`, `getLabelBatch`; the draft `POST /v1/labels/render` (synchronous) is gone. No new permission: `asset:label` (admin, asset manager, technician) and `catalog:manage` for calibration.
- Not done here: the web screen (M2-TAG-03; WEB-15 also wants "scan to add" and a preview, both client side), a per-tenant default logo setting, Unicode fonts, DataMatrix (M3 matrix decoding), purging expired `failed` rows, a quota on batches per user.
