# Engineering tools

- `gen.mjs` generates `../openapi.yaml`. From the repo root after `pnpm install` (`yaml` is a root devDependency): `node docs/engineering/tools/gen.mjs docs/engineering/openapi.yaml`, then lint with `npx -y @redocly/cli@2.79.0 lint ../openapi.yaml`.
  `openapi.yaml` is generated: never edit it by hand, change `gen.mjs` and regenerate. After a change run `pnpm --filter @assettracker/api-client generate` (CI fails on a stale `packages/api-client/src/generated/schema.ts`) and the API tests, which walk the contract. If `npm i` fails inside the monorepo, copy `gen.mjs` to an empty folder outside the repo, `npm i yaml` there and run it with the absolute path of `openapi.yaml` as the argument.

# SQL tests

`../tests/run_one.sh <16|17|18>` starts a throwaway `postgres:<ver>` container, applies `../schema.sql`, runs the isolation/constraint suite (102 checks) and prints `PASS=… FAIL=…`. Remove the container afterwards with `docker rm -f atdec<ver>`.
