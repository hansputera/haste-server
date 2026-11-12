# 0004: The `file` store is refused on serverless hosting

## Status

Accepted.

## Context

The `file` store writes pastes to `./data` on the local filesystem. On Vercel and
Netlify the deployed filesystem is read-only or ephemeral: writes either fail or
silently disappear at the next cold start. A request that returns `{"key":...}`
for a paste that will not exist in ten minutes is worse than an error, because
the user has already copied the link.

## Decision

- `createApp` throws at boot when `VERCEL` or `NETLIFY` is set and
  `storage.type === 'file'`, naming the stores that do work.
- Serverless entrypoints use the framework adapters rather than a hand-written
  request shim: `@hono/vercel`'s `handle` receives Node
  `IncomingMessage`/`ServerResponse`, `@hono/netlify`'s `handle` receives a Web
  `Request` and returns a `Response`.
- The serverless entrypoints import `dist/http.js`, so the deploy must build
  first (`vercel.json` and `netlify.toml` both run `npm run build`).
- `installShutdown` does not register signal handlers under a function runtime.
- `SECURITY.md` records that the `file` store is unsupported on serverless and
  whose fault that is (the hosting model, not the store).

## Consequences

- A misconfigured serverless deploy fails loudly at boot instead of losing data
  quietly.
- The Netlify handler is ~5 lines instead of ~150 lines of synthetic
  `IncomingMessage`/`Writable` plumbing.
- `netlify.toml` must declare `external_node_modules` for the packages the
  function bundles, since the `node_bundler` cannot see into `dist/`'s runtime
  imports.
- The security contact in `SECURITY.md` is a placeholder
  (`security@example.com`). It must be replaced with a monitored address before
  the first public release; an unreplaced placeholder is a documentation defect,
  not a build failure.
