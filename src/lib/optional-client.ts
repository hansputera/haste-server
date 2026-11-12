// Loader for the optional store clients and for the store/generator modules
// themselves.
//
// The third-party clients (redis, memcached, mongodb, aws-sdk,
// @google-cloud/datastore, rethinkdbdash) are deliberately never dependencies: a
// deployment that does not select a store must not need its client installed, so
// each is imported at runtime and typed structurally by the store that uses it.
//
// Dynamic `import()` resolves a relative specifier against *this* module, not
// the caller, so the caller passes its own `import.meta.url` as `base`. That is
// the one place `new URL` is needed.
//
// This is the one module allowed to bridge an untyped dynamic import into a
// typed value; every caller describes the shape it expects.
export const loadModule = <T>(specifier: string, base: string): Promise<T> =>
  import(specifier.startsWith('.') ? new URL(specifier, base).href : specifier) as Promise<T>;
