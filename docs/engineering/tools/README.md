# Engineering tools

- `gen.mjs` generates `../openapi.yaml`. Run from this folder: `npm i --no-save yaml && node gen.mjs ../openapi.yaml`, then lint with `npx -y @redocly/cli@2.79.0 lint ../openapi.yaml`.

# SQL tests

`../tests/run_one.sh <16|17|18>` starts a throwaway `postgres:<ver>` container, applies `../schema.sql`, runs the isolation/constraint suite (102 checks) and prints `PASS=… FAIL=…`. Remove the container afterwards with `docker rm -f atdec<ver>`.
