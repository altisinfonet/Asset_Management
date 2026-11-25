# Regenerating the guide screenshots

The pictures in [`../img/`](../img) are made by one script, [`shoot.mjs`](shoot.mjs), from a running, freshly seeded stack. It
signs in with the demo users of the repository README, creates the little data it needs through the real screens and API,
and takes the screenshots with Playwright (Chrome or Chromium, light theme, a 1280 x 800 window, each picture cropped to
the relevant part). It is a documentation tool: nothing runs it in CI.

## Run it

You need the repository set up as in [`../../getting-started.md`](../../getting-started.md) (`pnpm install`, Docker running,
and a Chrome installed, or Playwright's own browser).

```bash
# 1. A fresh stack (the demo data must not have been used: the script creates records with fixed names).
#    Use your own compose project and ports if the default stack is busy: see "Another stack" below.
docker compose up -d --build
curl http://localhost:3000/readyz              # repeat until it answers 200

# 2. The website, with /v1 forwarded to the api
pnpm turbo run build --filter=@assettracker/web
node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000 &

# 3. The pictures (several minutes: the import and label steps wait for the worker)
PW_CHANNEL=chrome node docs/guides/tools/shoot.mjs
```

The pictures land in `docs/guides/img/`. The script prints the size of each one and lists any over 200 KB.

| Option or variable     | Meaning                                                                      | Default                 |
| ---------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| `BASE_URL`             | the website, with the API behind it at `/v1`                                 | `http://localhost:3001` |
| `MAILPIT_URL`          | the mail catcher (the script reads an invitation mail from it)               | `http://localhost:8025` |
| `PW_CHANNEL`           | a browser channel such as `chrome`; leave unset to use Playwright's Chromium | Playwright's Chromium   |
| `OUT_DIR`              | where the PNG files go, relative to the repository root                      | `docs/guides/img`       |
| `--only=import,labels` | run only some stages (`--list` prints them)                                  | all, in order           |

The stages, in the order they must run on a fresh stack, and the guide each one feeds: `import` (guide 1), `google` (2),
`labels` (3), `loaners` (4), `notifications` (4), `repair` (5), `people` (7), `scope` (6), `k12` (8). Later stages use data that earlier ones
made (the labels use the tablets of the import, the loaner stage uses the same tablets), so run them together, or run
single stages on a stack that has had the earlier ones.

If a step fails, the script saves a picture of what the browser showed to your temp folder and prints its path.

### Another stack

When the default stack (ports 3000 and 3001) is in use, run a separate compose project on other ports, with a git-ignored
`.env` next to `docker-compose.yml`:

```bash
cat > .env <<'EOF'
API_PORT=16000
WEB_PORT=16081
POSTGRES_PORT=16033
PGBOUNCER_PORT=16032
MAILPIT_SMTP_PORT=16025
MAILPIT_UI_PORT=16026
MINIO_PORT=16090
MINIO_CONSOLE_PORT=16091
CLAMD_PORT=16031
SCAN_REQUIRED=false
EOF
docker compose -p atdoc up -d --build
node apps/web/scripts/serve-static.mjs apps/web/out --port=16080 --proxy=http://localhost:16000 &
MAILPIT_URL=http://localhost:16026 BASE_URL=http://localhost:16080 PW_CHANNEL=chrome node docs/guides/tools/shoot.mjs
docker compose -p atdoc down -v               # when you are done
```

`SCAN_REQUIRED=false` skips the virus scanner, so uploads are accepted at once (the first start of the scanner downloads
its signatures, which takes minutes). Do not use it on a real installation.

## What is in this folder

- [`shoot.mjs`](shoot.mjs): the script. Each stage is a function; a screenshot is `shot(page, name, region)`, where the
  region is the part of the page to keep (the window is made taller for the moment, so a long region is seen whole).
- [`samples/`](samples): the two small CSV files the guides use. `school-devices.csv` has two deliberate mistakes (a cost
  that is not a number and a row without a category); `chromeos-export.csv` is a made-up Google Admin export of ten
  Chromebooks. The students named in it are the demo students.

## Keeping the guides in step

When a screen or a text changes, run the script again and look at every picture (the script cannot tell that a picture
shows the wrong thing). The texts in the guides are copied from `apps/web/src/i18n/messages/`; search there for a
button or label to find its exact wording. Guide 6 shows the access dialog of **Change role and access** (add and remove
access, ED-27).
