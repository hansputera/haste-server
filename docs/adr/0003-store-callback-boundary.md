# 0003: The store boundary stays callback-shaped

## Status

Accepted.

## Context

Seven document stores exist: file, redis, memcached, mongo, postgres, amazon-s3,
google-datastore, rethinkdb. Each wraps a different client with a different
completion style, and each was written against `(key, callback, skipExpire)`.
Rewriting all of them to promises means seven independent migrations, each only
exercisable when its client is installed and reachable — which for most of them
never happens in CI.

## Decision

- The boundary is `DocumentStore` in `src/lib/types.ts`: callback-shaped `get`
  and `set`, with `string | false` as the miss sentinel.
- The `Promise` wrapper lives in `src/app.ts` (`getStore`, `setStore`), once,
  not in each store.
- `store.get`'s `resolve` is passed straight to the callback: a promise settles
  once, so a store that calls its callback twice cannot double-settle.
- No store gains a promise API. A store that later becomes promise-based is
  adapted where it is constructed, not by widening the interface.
- `string | false` rather than `string | undefined` keeps every existing `if
(data)` test meaningful and narrows the value for the JSON response.

## Consequences

- Adding a store is one file implementing two methods.
- Every store's failure mode is the same: callback `false`, handled centrally.
- Callback-shaped stores hide their async errors unless each one calls back on
  every path. The `DocumentStore` implementers are reviewed for that, and
  `createDocumentService` additionally catches a throwing `get`.
- If the codebase later needs streaming or partial reads, the interface would
  have to change; nothing today does.
