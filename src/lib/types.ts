// The internal contracts shared by the app, the stores and the key generators.
//
// Every store is callback-shaped and stays that way: the seven third-party
// clients each have their own completion style and rewriting all of them to
// promises would mean seven independent migration risks for no user-visible
// gain. The `Promise` wrapper lives in `core.ts` instead.

export type StoreCallback<T> = (result: T) => void;

export interface DocumentStore {
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void;
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void;
}

export interface KeyGenerator {
  createKey(length: number): string;
}

export interface KeyGeneratorOptions {
  type?: string;
  keyspace?: string;
  path?: string;
}

export interface RateLimitCategory {
  totalRequests: number | string;
  every: number | string;
}

export interface RateLimitConfig {
  whitelist?: string[];
  blacklist?: string[];
  categories?: {
    normal?: RateLimitCategory;
    whitelist?: RateLimitCategory | null;
    blacklist?: RateLimitCategory | null;
  };
}

export interface LoggingEntry {
  level?: string;
  type?: string;
  colorize?: boolean | string;
}

export interface StorageOptions extends Record<string, unknown> {
  type: string;
  path?: string;
  host?: string;
  port?: number | string;
  expire?: number | string | false;
  bucket?: string;
  region?: string;
  connectionUrl?: string;
  db?: string | number;
  user?: string;
  password?: string;
  keyspace?: string;
}

export interface Config {
  host?: string | number;
  port?: string | number;
  keyLength?: number;
  maxLength?: number;
  staticMaxAge?: number;
  recompressStaticAssets?: boolean;
  logging?: LoggingEntry[];
  keyGenerator?: KeyGeneratorOptions;
  rateLimits?: RateLimitConfig;
  storage: StorageOptions & Record<string, unknown>;
  documents?: Record<string, string>;
}
