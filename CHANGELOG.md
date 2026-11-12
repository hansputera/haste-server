# Changelog

This file is maintained by release-please from Conventional Commits. Do not edit
it by hand: `feat:` and `fix:` entries are generated from the pull request titles
merged into `main`.

## 1.0.0

### Behavior

- The server is TypeScript (strict) compiled to ESM `dist/`, running on Hono 4
  under Node ≥ 20 and Bun ≥ 1.4.
- Responses are gzip-compressed from build-time precompressed assets; static
  assets carry deterministic `cache-control` and API responses are `no-store`.
- Static token resolution reads a boot-time index instead of calling
  `fs.existsSync`/`fs.statSync` on every request.
- Syntax highlighting runs in a Web Worker, so a large paste no longer blocks
  the main thread.

### Operations

- `GET /healthz` (liveness) and `GET /readyz` (readiness) probes.
- `GET /openapi.json` serves the OpenAPI 3.1 contract.
- One JSON log line per request with `requestId`, `method`, `path`, `status`,
  `ms`; an inbound `X-Request-Id` is propagated.
- Central error handler: `HTTPException` keeps its response, everything else is
  an opaque `500 {"message":"Internal Server Error"}`.
- Config is validated at boot; a bad key fails with
  `invalid config: <key>: <detail>`.
- `SIGTERM`/`SIGINT` drain in-flight requests for up to 10 s, then exit 0.

### Packaging

- `file` storage is refused on Vercel and Netlify.
- Vercel and Netlify entrypoints use `@hono/vercel` and `@hono/netlify`.
- The Docker image is a two-stage build that runs as the unprivileged `node`
  user with a `wget` health check.

### Tooling

- CI covers typecheck, lint, format check, build, tests and `npm audit` on
  Node 20/22 plus a Bun smoke test.
- ESLint (flat, type-aware), Prettier, commitlint and dependabot are enforced.
