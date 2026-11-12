import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Memcached client shape. `memcached` is an optional client only installed by
// deployments that select this store, so it is typed structurally.
interface MemcachedClient {
  on(event: string, listener: (error: unknown) => void): void;
  set(key: string, data: string, lifetime: number, callback: (error: unknown) => void): void;
  get(key: string, callback: (error: unknown, data?: string) => void): void;
}

// Memcached is imported lazily: a deployment that does not select this store
// never needs the package installed.
export default class MemcachedDocumentStore implements DocumentStore {
  private readonly expire: number | string | false | undefined;
  private readonly url: string;
  private readonly clientPromise: Promise<MemcachedClient>;

  // Create a new store with options
  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;

    const host = options.host || '127.0.0.1';
    const port = options.port || 11211;

    this.url = `${host}:${port}`;
    this.clientPromise = this.connect(this.url);
  }

  // Create a connection
  async connect(url: string): Promise<MemcachedClient> {
    const { default: Memcached } = await loadModule<{
      default: new (url: string, options: unknown) => MemcachedClient;
    }>('memcached', import.meta.url);
    const client = new Memcached(url, {});

    log.info({ url }, 'connecting to memcached');

    client.on('failure', (error) => {
      log.info({ error: String(error) }, 'error connecting to memcached');
    });

    return client;
  }

  // Save file in a key
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    this.clientPromise
      .then(
        (client) =>
          new Promise<boolean>((resolve) => {
            client.set(key, data, skipExpire ? 0 : Number(this.expire) || 0, (error) =>
              resolve(!error)
            );
          })
      )
      .then((ok) => callback(ok))
      .catch(() => callback(false));
  }

  // Get a file from a key
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    this.clientPromise
      .then(
        (client) =>
          new Promise<string | false>((resolve) => {
            client.get(key, (error, data) => resolve(error || !data ? false : data));
          })
      )
      .then((value) => {
        callback(value);

        // Update the key so that the expiration is pushed forward
        if (value && !skipExpire) {
          this.set(
            key,
            value,
            (updateSucceeded) => {
              if (!updateSucceeded) {
                log.error({ key }, 'failed to update expiration on GET');
              }
            },
            skipExpire
          );
        }
      })
      .catch(() => callback(false));
  }
}
