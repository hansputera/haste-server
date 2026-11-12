import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of a redis v4 client.
interface RedisClient {
  on(event: string, listener: (error: unknown) => void): void;
  connect(): Promise<void>;
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<unknown>;
}

// For storing in redis
// options[type] = redis
// options[host] - The host to connect to (default localhost)
// options[port] - The port to connect to (default 5379)
// options[db] - The db to use (default 0)
// options[expire] - The time to live for each key set (default never)
//
// The `redis` package is imported lazily so a deployment that does not select
// this store never needs it installed (and a bare npm install stays small).
export default class RedisDocumentStore implements DocumentStore {
  static client: RedisClient | Promise<RedisClient> | false | undefined;

  private readonly expire: number | string | false | undefined;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;

    if (client) {
      log.info({}, 'using predefined redis client');
      RedisDocumentStore.client = client as RedisClient;
    } else if (!RedisDocumentStore.client) {
      log.info({}, 'configuring redis');
      RedisDocumentStore.connect(options);
    }
  }

  // Create a connection according to config. The client is stored
  // synchronously and connects in the background so store construction stays
  // synchronous, as every other store's constructor is.
  static connect(options: StorageOptions): void {
    const host = options.host || '127.0.0.1';
    const port = options.port || 6379;
    const index = options.db || 0;

    const clientPromise = (async () => {
      const { createClient } = await loadModule<{
        createClient: (options: unknown) => RedisClient;
      }>('redis', import.meta.url);
      const client = createClient({
        socket: { host, port },
        password: options.password || undefined,
        database: Number(index)
      });

      client.on('error', (error) => {
        log.error({ error: String(error) }, 'redis disconnected');
      });

      await client.connect();
      log.info({ host, port, index }, `connected to redis on ${host}:${port}/${String(index)}`);
      return client;
    })();

    RedisDocumentStore.client = clientPromise;

    clientPromise.catch((error: unknown) => {
      log.error({ error: String(error) }, 'error connecting to redis');
      process.exit(1);
    });
  }

  static connection(): Promise<RedisClient | undefined> {
    return Promise.resolve(RedisDocumentStore.client as RedisClient | undefined);
  }

  // Save file in a key
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    RedisDocumentStore.connection()
      .then((client) => client!.set(key, data))
      .then(async () => {
        if (!skipExpire) await this.setExpiration(key);
        callback(true);
      })
      .catch(() => callback(false));
  }

  // Expire a key in expire time if set
  async setExpiration(key: string): Promise<void> {
    if (!this.expire) return;

    try {
      const client = await RedisDocumentStore.connection();
      if (!client) return;
      await client.expire(key, Number(this.expire));
    } catch {
      log.error({ key }, 'failed to set expiry on key');
    }
  }

  // Get a file from a key
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    RedisDocumentStore.connection()
      .then((client) => client!.get(key))
      .then(async (reply) => {
        if (!this.expire || skipExpire) return callback(reply ?? false);
        await this.setExpiration(key);
        return callback(reply ?? false);
      })
      .catch(() => callback(false));
  }
}
