# Contributing

## Prerequisites

- Node.js **≥ 22** (24 LTS and 26 LTS are tested), **or** Bun ≥ 1.4. Node 20 is
  end-of-life and unsupported.
- pnpm ≥ 10 (`corepack enable` pins the version in `package.json`).

## Setup

```sh
pnpm install --frozen-lockfile
pnpm run build
```

## The five commands CI runs

Every pull request must pass, in this order:

```sh
pnpm run check         # tsc --noEmit, strict
pnpm run lint          # eslint, flat config, type-aware
pnpm run format:check  # prettier --check
pnpm run build         # tsc + precompress + copy assets
pnpm test              # node --test against dist/
```

Run them locally before pushing. `pnpm run format` fixes formatting; it is the only
command that writes to your tree.

The Redis store spec skips itself (`# SKIP redis not reachable on 127.0.0.1:6379`)
when no Redis is listening, so the suite passes on a machine without one.

## Layout

| path              | contents                                                           |
| ----------------- | ------------------------------------------------------------------ |
| `src/`            | TypeScript sources, compiled to `dist/` by `tsc`                   |
| `src/core.ts`     | framework-neutral request handling, stores, key selection          |
| `src/http.ts`     | Hono middleware, routes, error contract                            |
| `src/settings.ts` | config parse + validation                                          |
| `src/runtime.ts`  | Node/Bun listener and graceful shutdown                            |
| `static/`         | browser assets, served verbatim                                    |
| `test/`           | `node --test` specs, run against `dist/`                           |
| `scripts/`        | build-time tooling (`precompress`, `copy-assets`, `check-openapi`) |

`static/` is never restyled in a code pull request. Visual changes ship on their
own so a behaviour diff and a design diff are never reviewed together.

## Commits

Conventional Commits, enforced by `commitlint`:

```
type(scope): subject
```

| type       | use for                           |
| ---------- | --------------------------------- |
| `feat`     | user-visible behaviour            |
| `fix`      | a defect                          |
| `docs`     | documentation only                |
| `refactor` | no behaviour change               |
| `perf`     | measurably faster                 |
| `test`     | specs only                        |
| `build`    | tooling, dependencies, Dockerfile |
| `ci`       | workflows                         |
| `chore`    | everything else                   |
| `revert`   | a revert                          |

`feat:` and `fix:` entries become `CHANGELOG.md` entries through release-please.

## Pull request checklist

- [ ] `pnpm run check`, `lint`, `format:check`, `build`, `test` all pass locally.
- [ ] New behaviour has a spec in `test/`, or the PR states why no spec can capture it.
- [ ] Public surface changes (`/documents`, `/raw`, `/healthz`, `/readyz`) update
      `openapi.json`; `pnpm run check:openapi` passes.
- [ ] `src/` has no `console.*`; logging goes through `src/lib/log.ts`.
- [ ] No store client (`redis`, `memcached`, `mongodb`, …) was added to
      `package.json`: they stay optional and are imported at runtime.
- [ ] `static/` is untouched unless the PR is a visual change.
