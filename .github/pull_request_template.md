## What and why

<!-- One or two sentences. Link the backlog story (docs/05_backlog.md), for example M1-REG-03. -->

Story: M1-

## Changes

-

## Checklist

- [ ] `pnpm turbo run lint typecheck test build` passes locally
- [ ] Tests added or updated (unit; e2e for anything touching the database, auth, jobs or mail)
- [ ] New tenant table: ENABLE + FORCE RLS, policy, explicit grants, schema lint green (`docs/engineering/developer-guide.md`)
- [ ] Migrations follow expand/contract and `apps/api/prisma/schema.prisma` was regenerated (`pnpm --filter @assettracker/api db:pull`)
- [ ] API change: `docs/engineering/openapi.yaml` and the generated client are updated
- [ ] No secret, token or real credential in the diff (dev placeholders only); no new entry in an allow-list file without an expiry and a reason
- [ ] Logs and errors of the new code carry no passwords, tokens or keys; `tenant_id` is a log/trace attribute, never a metric label
- [ ] Docs updated where behaviour changed (ADR, developer guide, threat model)

## Risk and rollback

<!-- What could break, and how to undo it (revert, feature flag, contract-phase migration not yet applied). -->

## Evidence

<!-- Test output, screenshots, perf numbers. CI results appear below once the checks have run. -->
