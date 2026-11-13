import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Mongo client shape, kept structural: `mongodb` is an optional client that is
// only installed by deployments that select this store.
interface MongoCollection {
  updateOne(filter: unknown, update: unknown, options?: unknown): Promise<unknown>;
  findOne(filter: unknown): Promise<{ value: string; expiration: number } | null>;
}
interface MongoDb {
  collection(name: string): MongoCollection;
}

// mongodb is imported lazily: a deployment that does not select this store
// never needs the package installed.
export default class MongoDocumentStore implements DocumentStore {
  private readonly expire: number | string | false | undefined;
  private readonly connectionUrl: string | undefined;
  private readonly client?: { close(): Promise<void> };
  private db?: MongoDb;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;
    this.connectionUrl = process.env.DATABASE_URL || options.connectionUrl;
  }

  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    const now = Math.floor(new Date().getTime() / 1000);
    const expire = Number(this.expire) || undefined;

    this.safeConnect()
      .then((db) =>
        db.collection('entries').updateOne(
          { entry_id: key },
          {
            $set: {
              entry_id: key,
              value: data,
              expiration: expire && !skipExpire ? expire + now : -1
            }
          },
          { upsert: true }
        )
      )
      .then(() => callback(true))
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'error persisting value to mongodb');
        callback(false);
      });
  }

  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    const now = Math.floor(new Date().getTime() / 1000);
    const expire = Number(this.expire) || undefined;

    this.safeConnect()
      .then((db) =>
        db.collection('entries').findOne({
          entry_id: key,
          $or: [{ expiration: -1 }, { expiration: { $gt: now } }]
        })
      )
      .then((entry) => {
        callback(!entry ? false : entry.value);

        if (entry && entry.expiration !== -1 && expire && !skipExpire) {
          this.safeConnect()
            .then((db) =>
              db
                .collection('entries')
                .updateOne({ entry_id: key }, { $set: { expiration: expire + now } })
            )
            .catch((error: unknown) => {
              log.error({ error: String(error) }, 'failed to update expiration');
            });
        }
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'error retrieving value from mongodb');
        callback(false);
      });
  }

  async safeConnect(): Promise<MongoDb> {
    if (this.db) return this.db;

    try {
      const { MongoClient } = await loadModule<{
        MongoClient: new (url?: string) => { connect(): Promise<void>; db(): MongoDb };
      }>('mongodb');
      const client = new MongoClient(this.connectionUrl);
      await client.connect();
      this.db = client.db();
      return this.db;
    } catch (error) {
      log.error({ error: String(error) }, 'error connecting to mongodb');
      throw error;
    }
  }
}
