# 0001: TypeScript sources compiled with `tsc` to `dist/`

## Status

Accepted.

## Context

The server was ESM JavaScript with no type checking: a store that returned a
non-string, a handler that forgot an `await`, or a config field spelled
differently all failed at runtime, under load, in the one process that holds
every paste. The store boundary is callback-shaped and closed over seven
third-party clients, which is exactly where types pay for themselves.

The server also runs in three shapes: a long-lived Node process, a long-lived
Bun process, and serverless function handlers. Two of those run the sources
through their own loader.

## Decision

- Sources live in `src/`, are TypeScript, and compile to ESM in `dist/` with
  `tsc` only. `target: ES2024`, `module: NodeNext`, `moduleResolution: NodeNext`,
  `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- No bundler, no `tsx`, no `esbuild` for the server. Node runs `dist/`; Bun runs
  `src/` directly; tests run against `dist/` after a build.
- Relative imports keep their `.js` suffix in the sources. `NodeNext` emits them
  unchanged, which is what makes the output runnable without a resolver step.
- `static/` stays hand-written JavaScript. It is shipped verbatim and is not part
  of the compilation.

## Consequences

- A type error fails the build rather than a request. `npm run check` is the
  cheapest gate in CI.
- `dist/` is build output and is gitignored; `npm start` builds first via
  `prestart`, so a stale `dist/` cannot be served by accident.
- Bun executing `src/` means Bun needs no build step, at the cost of Bun owning
  its own TypeScript handling. If a deployment pins a Bun too old to strip types,
  `bun dist/server.js` is byte-identical output with no source change.
- Adding a bundler later would invalidate the `.js` specifier convention; the
  decision is reversible but not free.
