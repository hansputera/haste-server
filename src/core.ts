import fs from 'node:fs';
import path from 'node:path';

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { createLogger } from './lib/log.js';
import { loadModule } from './lib/optional-client.js';
import type { Config, DocumentStore, KeyGenerator, StorageOptions } from './lib/types.js';

// Everything framework-neutral: document lookup, key selection, static asset
// indexing, rate-limit construction and store/generator bootstrapping. Nothing
// here imports `hono`, so the tests exercise it without an HTTP server.

const log = createLogger();

// ---------------------------------------------------------------------------
// Stores and generators

// Build the store from config. Stores are loaded on demand so that a missing
// optional client (redis, memcached, ...) only fails the deployment that
// actually selects it.
//
// Every store is named literally rather than interpolated from `storage.type`:
// a bundler can only follow a static specifier, and Netlify's esbuild step emits
// a single CommonJS file where `import.meta.url` cannot resolve a computed path.
// The type is a validated enum member, so the switch is total.
const STORE_MODULES = {
  file: () => import('./lib/document_stores/file.js'),
  redis: () => import('./lib/document_stores/redis.js'),
  memcached: () => import('./lib/document_stores/memcached.js'),
  mongo: () => import('./lib/document_stores/mongo.js'),
  postgres: () => import('./lib/document_stores/postgres.js'),
  'amazon-s3': () => import('./lib/document_stores/amazon-s3.js'),
  'google-datastore': () => import('./lib/document_stores/google-datastore.js'),
  rethinkdb: () => import('./lib/document_stores/rethinkdb.js')
} as const;

type StoreType = keyof typeof STORE_MODULES;

interface StoreConstructor {
  new (options: StorageOptions, client?: unknown): DocumentStore;
}

const buildStore = async (storage: StorageOptions): Promise<DocumentStore> => {
  const load = STORE_MODULES[storage.type as StoreType];
  if (!load) throw new Error(`unknown storage type: ${storage.type}`);
  const { default: Store } = (await load()) as { default: StoreConstructor };

  // Heroku-style REDISTOGO_URL takes precedence over the host/port fields.
  if (process.env.REDISTOGO_URL && storage.type === 'redis') {
    const { createClient } = await loadModule<{
      createClient: (options: unknown) => {
        on: (event: 'error', listener: (error: unknown) => void) => void;
        connect: () => Promise<void>;
      };
    }>('redis');
    const client = createClient({ url: process.env.REDISTOGO_URL });
    client.on('error', (error: unknown) => {
      log.error({ error: String(error) }, 'redis client error');
    });
    await client.connect();
    return new Store(storage, client);
  }

  return new Store(storage);
};

// A store whose backend is decided per request rather than at boot.
//
// The `file` store is usable on a long-lived Node process but not on a
// serverless one, and the same image or bundle can be pointed at either. This
// wrapper keeps the whole app booting on a platform whose filesystem is only
// writable from *inside* an invocation: Vercel exposes one scratch directory
// (`/tmp`) that exists during a request and not before it.
//
// Construction is deferred to the first `get` or `set`; after that the
// instance is reused for the life of the process.
export const createDeferredFileStore = (storage: StorageOptions, storeLog = log): DocumentStore => {
  let inner: DocumentStore | undefined;

  const resolve = async (): Promise<DocumentStore> => {
    // The `file` store has no expirations and no in-process state worth
    // initialising, so construction is memoised and nothing else is needed.
    inner ??= await buildStore(storage);
    return inner;
  };

  return {
    get(key, callback, skipExpire) {
      resolve().then(
        (store) => store.get(key, callback, skipExpire),
        (error: unknown) => {
          storeLog.error({ error: String(error) }, 'file store unavailable');
          callback(false);
        }
      );
    },
    set(key, data, callback, skipExpire) {
      resolve().then(
        (store) => store.set(key, data, callback, skipExpire),
        (error: unknown) => {
          storeLog.error({ error: String(error) }, 'file store unavailable');
          callback(false);
        }
      );
    }
  };
};

// Build the store the deployment asked for.
//
// On serverless hosting the filesystem exists only inside an invocation, so the
// `file` store is built on first use instead of at boot; everywhere else it is
// built eagerly so a bad path fails the rollout, not the first paste.
export const createStore = async (
  storage: StorageOptions,
  serverless = Boolean(process.env.VERCEL || process.env.NETLIFY)
): Promise<DocumentStore> =>
  serverless && storage.type === 'file' ? createDeferredFileStore(storage) : buildStore(storage);

// Pick up a key generator
//
// Static specifiers for the same reason as the stores: a bundler cannot follow
// an interpolated path, and a CommonJS bundle has no `import.meta.url` to
// resolve one against.
const KEY_GENERATOR_MODULES = {
  random: () => import('./lib/key_generators/random.js'),
  phonetic: () => import('./lib/key_generators/phonetic.js'),
  dictionary: () => import('./lib/key_generators/dictionary.js')
} as const;

type KeyGeneratorType = keyof typeof KEY_GENERATOR_MODULES;

export const createKeyGenerator = async (
  options: { type?: string } = {}
): Promise<KeyGenerator> => {
  const type = options.type || 'random';
  const load = KEY_GENERATOR_MODULES[type as KeyGeneratorType];
  if (!load) throw new Error(`unknown key generator: ${type}`);

  const { default: Generator } = (await load()) as {
    default: new (options: { type?: string }) => KeyGenerator;
  };
  return new Generator(options);
};

// Send the static documents into the preferred store, skipping expirations
//
// Seed paths are relative to the application, not to the process working
// directory: a serverless bundle and a `dist`-only install do not run from the
// directory the paths were authored against. Absolute paths are left alone.
export const seedDocuments = (
  store: DocumentStore,
  documents: Record<string, string> | undefined,
  seedLog = log,
  root = process.cwd()
): void => {
  for (const name in documents) {
    const configuredPath = documents[name] as string;
    const documentPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(root, configuredPath);
    let data: string | null;

    seedLog.info({ name, path: documentPath }, 'loading static document');

    try {
      data = fs.readFileSync(documentPath, 'utf8');
    } catch {
      data = null;
    }

    if (data) {
      store.set(
        name,
        data,
        (success) => {
          seedLog.debug({ success }, 'loaded static document');
        },
        true
      );
    } else {
      seedLog.warn({ name, path: documentPath }, 'failed to load static document');
    }
  }
};

// ---------------------------------------------------------------------------
// Document service

export type DocumentLookup = { found: true; data: string; key: string } | { found: false };
export type AddResult = { ok: true; key: string } | { ok: false; reason: 'too-long' | 'store' };

export interface DocumentService {
  getDocument(id: string): Promise<DocumentLookup>;
  addDocument(body: string): Promise<AddResult>;
  chooseKey(): Promise<string>;
}

// guillotine for a store that never yields an unused key
const MAX_KEY_ATTEMPTS = 100;
const DEFAULT_KEY_LENGTH = 10;

const getStore = (
  store: DocumentStore,
  key: string,
  skipExpire: boolean
): Promise<string | false> => new Promise((resolve) => store.get(key, resolve, skipExpire));

const setStore = (
  store: DocumentStore,
  key: string,
  data: string,
  skipExpire?: boolean
): Promise<boolean> => new Promise((resolve) => store.set(key, data, resolve, skipExpire));

export const createDocumentService = (
  store: DocumentStore,
  config: Config,
  keyGenerator: KeyGenerator,
  serviceLog = log
): DocumentService => {
  const keyLength = config.keyLength || DEFAULT_KEY_LENGTH;
  const maxLength = config.maxLength;

  const acceptableKey = (): string => keyGenerator.createKey(keyLength);

  const chooseKey = async (): Promise<string> => {
    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
      const key = acceptableKey();
      // Don't bump expirations when key searching
      const taken = await getStore(store, key, true);
      if (!taken) return key;
    }

    throw new Error('Unable to find an unused key');
  };

  return {
    async getDocument(id: string): Promise<DocumentLookup> {
      const key = id.split('.')[0] as string;
      const skipExpire = Boolean(config.documents?.[key]);

      try {
        const data = await getStore(store, key, skipExpire);
        if (!data) {
          serviceLog.warn({ key }, 'document not found');
          return { found: false };
        }
        serviceLog.verbose({ key }, 'retrieved document');
        return { found: true, data, key };
      } catch (error) {
        serviceLog.error({ error: String(error) }, 'document handler error');
        throw error;
      }
    },

    async addDocument(body: string): Promise<AddResult> {
      // Re-checked here even though `bodyLimit` pre-checks Content-Length: a
      // chunked upload has no length header.
      if (maxLength && body.length > maxLength) {
        serviceLog.warn({ maxLength }, 'document >maxLength');
        return { ok: false, reason: 'too-long' };
      }

      try {
        const key = await chooseKey();
        const stored = await setStore(store, key, body);
        if (!stored) return { ok: false, reason: 'store' };
        serviceLog.verbose({ key }, 'added document');
        return { ok: true, key };
      } catch (error) {
        serviceLog.error({ error: String(error) }, 'error adding document');
        return { ok: false, reason: 'store' };
      }
    },

    chooseKey
  };
};

// ---------------------------------------------------------------------------
// Static asset index

export interface StaticIndex {
  files: ReadonlySet<string>;
  tokenAncestors: ReadonlySet<string>;
}

const toPosix = (value: string): string => value.split(path.sep).join('/');

// Walk a directory recursively, returning POSIX paths from the directory root,
// each prefixed with '/'.
//
// Explicit recursion rather than `readdirSync({ recursive: true })`: the
// `Dirent.parentPath` field that pairs with it only exists from Node 20.12, and
// this package supports Node 20 generally.
const walk = (dir: string): string[] => {
  const files: string[] = [];

  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push('/' + toPosix(path.relative(dir, absolute)));
      }
    }
  };

  visit(dir);
  return files.sort();
};

// Every proper directory prefix of every static file: `/nested` for
// `/nested/x.html`. A path that does not exist but is a token ancestor is
// served by serveStatic's own directory index rather than rewritten to
// `/index.html`.
const indexTokenAncestors = (paths: readonly string[]): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const file of paths) {
    const parts = file.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length - 1; i++) out.add('/' + parts.slice(0, i).join('/'));
  }
  return out;
};

export const buildStaticIndex = (dir: string): StaticIndex => {
  const files = walk(dir);
  return { files: new Set(files), tokenAncestors: indexTokenAncestors(files) };
};

const CACHEABLE_EXTENSIONS = /\.(js|css|png|ico)$/;

export const staticCacheControl = (pathname: string, index: StaticIndex, maxAge = 86400): string =>
  index.files.has(pathname) && CACHEABLE_EXTENSIONS.test(pathname)
    ? `public, max-age=${maxAge}`
    : 'no-cache';

// ---------------------------------------------------------------------------
// Rate limiting

export interface RateLimitRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface RateLimitResponse {
  status(code: number): RateLimitResponse;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export type RateLimitHandler = (
  request: RateLimitRequest,
  response: RateLimitResponse,
  next: () => void
) => void;

// Translate the config `rateLimits` block (shaped for connect-ratelimit) into a
// single express-rate-limit chain. connect-ratelimit resolved clients to
// whitelist/blacklist/normal categories by hostname; the same mapping is
// preserved here so an existing config keeps its meaning.
//
// express-rate-limit is used as a plain function, not as express middleware: it
// only needs `ip`/`socket` on the request and `status`/`setHeader`/`end` on the
// response.
export const buildRateLimiter = (options: Config['rateLimits']): RateLimitHandler | null => {
  if (!options) return null;

  const categories = options.categories || {};
  const normal = categories.normal || { totalRequests: 500, every: 60000 };
  const whitelist = categories.whitelist;
  const blacklist = categories.blacklist;
  const whitelisted = options.whitelist || [];
  const blacklisted = options.blacklist || [];

  const toLimiter = (
    category: { totalRequests: number | string; every: number | string } | null | undefined,
    fallbackWindow: number
  ): RateLimitHandler | null => {
    if (!category) return null;
    const windowMs = Number(category.every) || fallbackWindow;
    const limit = Number(category.totalRequests);
    if (!windowMs || Number.isNaN(limit)) return null;

    // express-rate-limit is typed against express's Request/Response. The
    // structural interfaces here are its documented framework-agnostic subset;
    // the cast is the one place that boundary is asserted, and the adapter in
    // `src/http.ts` supplies exactly these members.
    const limiter: unknown = rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Key on request.ip explicitly: on a serverless host the socket has no
      // remote address, and express-rate-limit rejects an empty default key.
      // `ipKeyGenerator` collapses IPv6 to its /56 subnet, which is what stops
      // a client rotating through its own /64 from minting unlimited buckets.
      keyGenerator: (request: RateLimitRequest) =>
        ipKeyGenerator(request.ip || request.socket?.remoteAddress || 'unknown'),
      handler: (_request: RateLimitRequest, response: RateLimitResponse) => {
        response.setHeader('content-type', 'application/json');
        response.status(429).end(JSON.stringify({ message: 'Rate limit exceeded.' }));
      }
    });

    return limiter as RateLimitHandler;
  };

  const normalLimiter = toLimiter(normal, 60000);
  const whitelistLimiter = toLimiter(whitelist, 60000);
  const blacklistLimiter = toLimiter(blacklist, 60000);

  return (request, response, next) => {
    // A serverless host puts the client address on the socket only; the host
    // header is not a security boundary, so the peer address is the key.
    const client = request.ip || request.socket?.remoteAddress || '';

    if (whitelisted.includes(client)) {
      // whitelisted clients have no limit unless a category was configured
      return whitelistLimiter ? whitelistLimiter(request, response, next) : next();
    }

    if (blacklisted.includes(client) && blacklistLimiter) {
      return blacklistLimiter(request, response, next);
    }

    return normalLimiter ? normalLimiter(request, response, next) : next();
  };
};
