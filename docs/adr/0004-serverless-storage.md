# 0004: Storage on serverless hosting

## Status

Accepted. Supersedes the earlier decision to refuse `file` storage at boot.

## Context

The `file` store writes pastes to a directory on the local filesystem. On Vercel
and Netlify that filesystem is not mounted at cold start and is not shared
between instances; whatever is written during an invocation can disappear at the
next one. A request that returns `{"key":...}` for a paste that will not exist
in ten minutes is worse than an error, because the user has already copied the
link.

The first version of this ADR handled that by refusing to boot with
`storage.type === 'file'` when `VERCEL` or `NETLIFY` was set. That made the
`file` store unusable on the one platform where a zero-configuration preview is
most useful, and it did not actually protect anything: the operator who wanted
the file store could still point `storage.path` at `/tmp` and lose data quietly.

Vercel also exposes `/tmp` — writable, per-instance, and absent until an
invocation runs. It is a legitimate place for a throwaway pastebin, and it is
the only writable path a `file` deployment has there.

## Decision

- `createApp` no longer refuses `file` storage. The store is built by
  `createStore`, which **defers construction to the first `get`/`set`** when
  `VERCEL` or `NETLIFY` is set, because `/tmp` does not exist at cold start in
  every runtime shape. Elsewhere the store is built eagerly, so a bad path fails
  the rollout rather than the first paste.
- Which directory is the deployment's decision, and the docs say so plainly:
  `HASTE_STORAGE__PATH=/tmp/haste` works, survives the instance, and is lost when
  the instance is recycled. A durable deployment uses `postgres`, `redis`,
  `mongo`, `memcached`, `amazon-s3`, `google-datastore` or `rethinkdb`.
- Seeded documents (`documents`, `HASTE_DOCUMENTS='about=./about.md'`) resolve
  relative paths against the **application root** (`dist/..`), not the process
  working directory. A function bundle and a `dist`-only npm install do not run
  from the directory the paths were authored against.
- Serverless entrypoints call `prepareForServerless`, which additionally marks
  the app ready. Nothing installs a listener or a signal handler there, so
  without it `/readyz` answers `503` for the life of every instance and a
  platform health check reads a healthy deployment as down.
- Serverless entrypoints use the framework adapters rather than a hand-written
  request shim: `@hono/vercel`'s `handle` receives Node
  `IncomingMessage`/`ServerResponse`, `@hono/netlify`'s `handle` receives a Web
  `Request` and returns a `Response`.
- The serverless entrypoints import `dist/http.js`, not `src/`. Vercel's bundler
  rewrites relative specifiers from source files onto its own cache paths, and
  the app resolves `static/` and `openapi.json` from its own location.
- `installShutdown` does not register signal handlers under a function runtime.

## Consequences

- A `file` deployment on Vercel works and loses data when the instance is
  recycled. That trade is documented in `docs/deployment.md` and `SECURITY.md`
  instead of being enforced.
- `vercel.json` must ship `static/`, `openapi.json` and `about.md` through
  `includeFiles`; the latter two are resolved at runtime, not build time.
- `netlify.toml` must declare `external_node_modules` for the packages the
  function bundles, since the `node_bundler` cannot see into `dist/`'s runtime
  imports.
- `HASTE_CONFIG=` (empty) means "no file layer"; a serverless deploy should set
  it so configuration comes entirely from the environment and no `config.js`
  has to ship.
- Reporting is closed over a single address, `personal@hanifu.id`, in
  `SECURITY.md`. That mailbox is the whole disclosure path: if it is not
  monitored, reports are silently dropped.
