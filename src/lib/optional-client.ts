// Loader for the optional store clients and for the store/generator modules
// themselves.
//
// The third-party clients (redis, memcached, mongodb, aws-sdk,
// @google-cloud/datastore, rethinkdb) are deliberately never dependencies: a
// deployment that does not select a store must not need its client installed, so
// each is imported at runtime and typed structurally by the store that uses it.
//
// Two specifier kinds:
//
//  - A package name (`redis`, `pg`) is resolved by Node's own resolver, so it
//    needs no base.
//  - A relative specifier points into this package. `import()` resolves it
//    against the *calling module*, so the caller passes `import.meta.url`. A
//    CommonJS bundle has no meaningful `import.meta.url`, so `base` is optional
//    and a `file:` URL is only constructed when one is supplied; a bundled
//    deployment selects a store by name and never takes this path.
//
// This is the one module allowed to bridge an untyped dynamic import into a
// typed value; every caller describes the shape it expects.
export const loadModule = <T>(specifier: string, base?: string): Promise<T> => {
  if (!specifier.startsWith('.')) return import(specifier) as Promise<T>;
  if (!base) {
    throw new Error(
      `cannot load ${specifier}: a relative module needs a base URL, and this ` +
        'build has no import.meta.url (a CommonJS bundle)'
    );
  }
  return import(new URL(specifier, base).href) as Promise<T>;
};
