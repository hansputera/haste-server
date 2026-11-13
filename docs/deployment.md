# Deploying Haste

The application is one Hono handler. Every host below runs the same code; only
the storage and the configuration layer change.

## What every deployment needs

| Requirement                         | Why                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Node.js ≥ 22**                    | `engines` requires it. Node 20 is end-of-life and receives no security fixes.                                  |
| **A build step** (`pnpm run build`) | The app runs from `packages/api/dist/`. Serverless entrypoints import `packages/api/dist/http.js`, not `src/`. |
| **A document store**                | Anything except a durable `file` directory loses pastes at the next restart.                                   |
| **`HASTE_STORAGE__TYPE`**           | Defaults to `file`.                                                                                            |

Configuration resolves in one order: defaults, then the config file, then the
environment. `HASTE_*` beats the legacy names (`STORAGE_TYPE`, `PORT`, …), and
`<VAR>_FILE` beats both. See [configuration.md](configuration.md) for every key.

## Vercel

### 1. Storage

`file` works on Vercel but is **not durable**: Vercel mounts no writable
filesystem at cold start, only `/tmp` during an invocation, and each instance is
recycled. Point it explicitly at `/tmp` or use a managed database.

For anything you expect to still exist tomorrow, use Postgres — it is the only
store whose client is a regular dependency, so nothing extra has to be installed:

```bash
# e.g. Neon, Supabase, Vercel Postgres
HASTE_STORAGE__TYPE=postgres
DATABASE_URL=postgres://user:password@host/db?sslmode=require
```

`rethinkdb`, `amazon-s3`, `google-datastore`, `memcached`, `mongo` and `redis`
work too, but their drivers are optional: add the client to `package.json`
first (`rethinkdb`, `@aws-sdk/client-s3`, `@google-cloud/datastore`, …) or the
function fails at the first request. `pg` is already installed.

#### Postgres schema

The store creates no tables. Run this once against the database:

```sql
create table entries (
  id serial primary key,
  key varchar(255) not null,
  value text not null,
  expiration int,
  unique (key)
);
```

`expiration` is a Unix timestamp in seconds and is `null` when the document does
not expire. Set `HASTE_STORAGE__EXPIRE` (seconds; legacy `STORAGE_EXPIRE_SECONDS`)
to expire pastes.

### 2. Environment variables

Project → Settings → Environment Variables. Minimum set:

| Variable              | Value          | Notes                                                                                |
| --------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `HASTE_STORAGE__TYPE` | `postgres`     | Or `file` for a disposable demo.                                                     |
| `DATABASE_URL`        | `postgres://…` | Read directly by the `pg` pool.                                                      |
| `HASTE_CONFIG`        | _(empty)_      | An empty value means **no config file**. Without this the app looks for `config.js`. |
| `HASTE_STORAGE__PATH` | `/tmp/haste`   | Only when the store is `file`. **Required** in that case.                            |
| `HASTE_MAX_LENGTH`    | `400000`       | Optional. Documents larger than this are a `400`.                                    |
| `HASTE_KEY_LENGTH`    | `10`           | Optional.                                                                            |

Do not set `HOST` or `PORT`: Vercel supplies neither and the function does not
listen.

`HASTE_DOCUMENTS=about=./about.md` seeds the built-in About paste. The path is
resolved against the application root, so it works inside the function bundle.

### 3. Node version

Vercel's default is Node 20, which this package rejects. `.nvmrc` at the
repository root pins **24**; `engines.node` is `>=22`. Confirm the function runs
24 by checking the deployment's build log — `pnpm add` prints the resolved
version.

### 4. Build and files

Leave the project's **Root Directory** at the repository root — the default when
you import the repository. `vercel.json` and `api/index.ts` sit there, because
Vercel only turns files in the _project root's_ `api/` directory into functions.
A config or an entry inside `packages/api` is invisible to it, and the build then
fails with:

```
[BUILD_FAILED] No entrypoint found in "/vercel/path0"
```

`/vercel/path0` is the repository root. The root entry is three lines of
adaptor over the compiled package (`packages/api/dist/http.js`), so `static/`,
`openapi.json` and the fonts still resolve from the package root that
`includeFiles` ships.

``vercel.json` declares everything:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "pnpm --filter @haste/api build && pnpm --filter @haste/web build",
  "outputDirectory": "packages/api/static",
  "functions": {
    "api/index.ts": {
      "maxDuration": 30,
      "includeFiles": "{packages/api/static/**,packages/api/openapi.json,packages/api/about.md,node_modules/@resvg/resvg-wasm/index_bg.wasm}"
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

Four properties are load-bearing:

- **`framework: null`.** Without it Vercel auto-detects a Node project and
  starts `packages/api/src/server.ts` as a long-running app: that entry binds a port and
  requires `config.js`, so the deployment dies with
  `cannot read config.js: file does not exist`. `null` is how `vercel.json`
  selects the "Other" framework preset, which leaves `api/index.ts` as the only
  entry.

- **`outputDirectory: "packages/api/static"`.** With no framework selected,
  Vercel still expects a static output directory and defaults to `public`, which
  this project does not have (`[STATIC_BUILD_NO_OUT_DIR] No Output Directory
named "public"`). The built SPA is copied into that directory by the web
  build, which is why `buildCommand` runs both packages. Its files are served from the CDN, and because
  the filesystem is checked before rewrites, everything else — `/documents`,
  `/raw/…`, `/healthz` — falls through to the function.

- **No `builds`.** Vercel rejects a config that pairs `builds` with `functions`
  ("The functions property cannot be used in combination with builds"), and
  `builds` is the legacy mechanism anyway. `api/index.ts` is detected as a
  function without being declared.
- **`rewrites`, not `routes`.** `routes` is the legacy counterpart to `builds`.
  A function named `api/index.ts` is served at `/api/index`, which is the
  rewrite destination.

`includeFiles` is not optional: `packages/api/static/` is served from disk and `about.md` is
read at boot. Without it the deployment answers `404` for every asset and logs
`failed to load static document`.

`.vercelignore` keeps tests, docs and the Docker file out of the upload. Do not
add `*.md` to it — Vercel keeps the first matching rule, so it would also drop
`about.md`.

### 5. Deploy

```bash
pnpm run build          # prove it compiles locally first
pnpm dlx vercel             # preview
pnpm dlx vercel --prod      # production
```

Or connect the Git repository and let Vercel build on push. Every push builds
one function from `api/index.ts`.

### 6. Verify

```bash
curl -s https://<deployment>/healthz              # {"status":"ok"}
curl -s https://<deployment>/readyz               # {"status":"ready"}
curl -s https://<deployment>/openapi.json | head  # the contract
echo hello | curl -s --data-binary @- \
  -H 'content-type: text/plain' https://<deployment>/documents   # {"key":"…"}
curl -s https://<deployment>/documents/<key>      # {"data":"hello","key":"<key>"}
curl -s https://<deployment>/                    # the paste page
```

A `503` on `/readyz` means the app never finished booting — read the function
logs for the `config resolved` line and the error after it.

### Known limits on Vercel

- **Cold starts** rebuild the store client and re-read the static index. A
  Postgres deployment pays one TLS handshake per cold instance.
- **The `file` store** lives in `/tmp`, per instance. Two concurrent instances do
  not see each other's pastes.
- **Rate limiting** is in-process, so each instance counts separately. With
  several instances the effective limit is approximately _limit × instances_.
- **The 100 MiB upload ceiling** is larger than Vercel's own request body limit;
  Vercel rejects the request first.
- **No graceful shutdown signals.** `installShutdown` registers nothing on a
  function runtime.

## Netlify

`netlify.toml` builds with `pnpm --filter @haste/api build` and routes every path
to `packages/api/netlify/functions/server`. The same environment variables apply,
plus `external_node_modules` already lists `hono`, `pino`, `satori` and
`@resvg/resvg-wasm` so the bundler leaves them external. Set
`HASTE_STORAGE__PATH=/tmp/haste` if you use the `file` store; everything above
about durability applies.

## Docker / a long-lived process

```bash
docker build -t haste .
docker run -d -p 7777:7777 \
  -e HASTE_STORAGE__TYPE=file \
  -e HASTE_STORAGE__PATH=/data \
  -v haste-data:/data \
  haste
```

The image runs as uid 1000, so the mounted volume must be writable by that user.
Health: `GET /healthz` (liveness) and `GET /readyz` (readiness). `SIGTERM`
drains in-flight requests for up to 10 seconds before exiting.

Without a volume the `file` store writes inside the container and loses pastes on
recreation — the same trap as serverless, without the excuse.

## Bare Node

```bash
pnpm install --frozen-lockfile
pnpm run build
HASTE_STORAGE__TYPE=file HASTE_STORAGE__PATH=/var/lib/haste pnpm start
```

`pnpm start` runs `packages/api/dist/server.js`, which listens on `HASTE_HOST`:`HASTE_PORT`
(`0.0.0.0:7777`). `bun packages/api/src/server.ts` runs the same app on Bun.
