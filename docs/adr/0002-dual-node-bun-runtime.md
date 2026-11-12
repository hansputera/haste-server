# 0002: One application, two runtimes (Node and Bun)

## Status

Accepted.

## Context

The deployment surface is a container, a Procfile, Vercel and Netlify. Node is
the common denominator; Bun is materially faster at the static-file and JSON
paths this server spends most of its time on. Maintaining two implementations
is not an option: the request semantics, the error contract and the logging
shape must be identical everywhere.

## Decision

- `src/http.ts` returns a Hono app. Hono's `fetch(request)` is the only interface
  the runtimes share.
- `src/runtime.ts` picks the listener: `Bun.serve({ fetch })` when `typeof Bun
!== 'undefined'`, `createAdaptorServer({ fetch })` from `@hono/node-server`
  otherwise. The Bun branch is guarded by an ambient declaration, so `@types/bun`
  is not a dependency.
- Process lifecycle (SIGTERM/SIGINT, readiness, drain window) lives only in
  `installShutdown`. It refuses to register handlers when `SERVERLESS`, `VERCEL`
  or `NETLIFY` is set, because a function runtime owns its own lifecycle.
- Both branches log the same `listening on <host>:<port>` line.

## Consequences

- Parity is testable: the same HTTP matrix runs against 7777 (Node) and 7778
  (Bun) and must agree.
- `typeof Bun` is a runtime check, not a compile-time one; a typo in the branch
  is caught only by running under Bun. CI runs a Bun smoke test for that reason.
- The drain window is 10 s. A request still running after it is killed with exit
  code 1, which is visible to an orchestrator as a failed shutdown rather than a
  silent truncation.
