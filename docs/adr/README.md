# Architecture decision records

An ADR records one decision that is expensive to reverse: the context, the options considered, the
decision, and what follows from it. Smaller decisions that change the contract or the data model are
numbered `ED-nn` in [`../engineering/decisions.md`](../engineering/decisions.md) instead.

## Index

| ADR                                                          | Title                                                                         | Status                                     | Date                      | Stories                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- | --------------------------------- |
| [0001](0001-data-access-and-migrations.md)                   | Data access layer, migration tool, database roles and ids                     | ACCEPTED (founder, 2026-11-18)             | 2026-11-17, rev. 2026-11-18 | M1-DB-01, M1-DB-02, M1-TEN-01..03 |
| [0002](0002-web-routing-static-export.md)                    | Web routing under Next.js static export (query-string detail routes)          | ACCEPTED (founder, 2026-11-18)             | 2026-11-17                | M1-WEB-10, M1-WEB-01              |
| [0003](0003-module-boundaries-and-api-conventions.md)        | Module boundary lint and API conventions (platform kernel)                    | PROPOSED, needs founder sign-off           | 2026-11-18                | M1-PLAT-01, M1-PLAT-02            |
| [0004](0004-platform-services.md)                            | Platform services: audit, outbox, jobs, secret box, mail, observability       | PROPOSED, needs founder sign-off           | 2026-11-18                | M1-PLAT-04..09, M1-OPS-01         |
| [0005](0005-asset-registry.md)                               | Asset registry: RLS-safe indexing, tag numbering, lists and bulk operations   | PROPOSED, needs founder sign-off           | 2026-11-18                | M1-REG-01..11, M1-PLAT-03, M1-TEN-04 |
| [0006](0006-files-scanning-and-thumbnails.md)                | Files: storage adapter, upload pipeline, virus scanning, thumbnails, file serving, scan codes | PROPOSED, needs founder sign-off | 2026-11-19 | M2-FILE-01..03, M2-SEC-02, M2-TAG-01 |
| [0007](0007-label-rendering.md)                              | Label rendering: pure-JS PDF and barcode libraries, fixed templates, asynchronous batches | PROPOSED, needs founder sign-off | 2026-11-19 | M2-TAG-02 |
| [0008](0008-accessories-consumables-stock.md)                | Accessories and consumables: derived availability, the stock ledger, minimum-stock events | PROPOSED, needs founder sign-off | 2026-11-19 | M2-ACC-01..03 |
| [0009](0009-repairs-notifications-views-exports.md)          | Repairs, notifications (NOTIFIER port, subscriber table, digest), saved views, CSV export | PROPOSED, needs founder sign-off | 2026-11-19 | M2-MNT-01, M2-NOT-01, M2-REG-01/02, M2-AUTH-01 |

Status values: `PROPOSED` (written by Claude, waiting for the founder), `ACCEPTED`, `SUPERSEDED by
ADR nnnn`, `REJECTED`. An accepted ADR is not edited except to fix mistakes or to mark it superseded;
a changed decision gets a new ADR.

## Backlog coverage (M1-DOC-01)

The backlog asks for ADRs on seven topics. Where each one is recorded today:

| Topic                      | Recorded in                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Data access layer          | ADR 0001 (Prisma 7 with the `pg` driver adapter, raw SQL migrations stay the source of truth)                        |
| Migration tool             | ADR 0001 (SQL files applied by the repo's own migrator as `app_owner`, checksum ledger; Prisma generated from them) |
| Boundary-lint tool         | ADR 0003 (ESLint `no-restricted-imports`, no new dependency)                                                         |
| Web routing                | ADR 0002                                                                                                            |
| ID strategy                | ADR 0001 (UUIDv7 generated in the application; `decisions.md` ED-08 removed the database-side defaults)              |
| State types                | `decisions.md` ED-02 (`undeployable`) and `docs/engineering/data_model.md`; no separate ADR                          |
| Breached-password provider | `docs/engineering/auth-security.md` section 2 (bundled list, optional HIBP k-anonymity) and ED-14; no separate ADR   |

## Writing a new ADR

1. Copy the structure of ADR 0001 (Context, Options considered, Decision, Consequences).
2. Name it `NNNN-short-title.md` with the next free number and add a row to the index above.
3. Set `Status: PROPOSED`, link the backlog stories, and get the founder's decision before the code
   that depends on it merges (CODEOWNERS covers `docs/adr/`).
