import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of @google-cloud/datastore, which is an optional
// client only installed by deployments that select this store.
interface DatastoreEntity {
  value: string;
  expiration: Date | null;
  [field: string]: unknown;
}
interface DatastoreClient {
  key(path: unknown[]): unknown;
  insert(entity: unknown): Promise<unknown>;
  get(key: unknown): Promise<[DatastoreEntity | undefined]>;
  update(entity: unknown): Promise<unknown>;
  delete(key: unknown): Promise<unknown>;
}

// @google-cloud/datastore is imported lazily: a deployment that does not select
// this store never needs the package installed.
export default class GoogleDatastoreDocumentStore implements DocumentStore {
  private readonly kind = 'Haste';
  private readonly expire: number | string | false | undefined;
  private datastorePromise: Promise<DatastoreClient> | null = null;

  // Create a new store with options
  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expire = options.expire;
    this.datastorePromise = null;
  }

  datastore(): Promise<DatastoreClient> {
    if (!this.datastorePromise) {
      this.datastorePromise = loadModule<{
        default: new () => DatastoreClient;
      }>('@google-cloud/datastore').then(({ default: Datastore }) => new Datastore());
    }
    return this.datastorePromise;
  }

  // Save file in a key
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    const expireTime =
      skipExpire || this.expire === undefined
        ? null
        : new Date(Date.now() + Number(this.expire) * 1000);

    this.datastore()
      .then((datastore) => {
        const taskKey = datastore.key([this.kind, key]);

        return datastore.insert({
          key: taskKey,
          data: [
            { name: 'value', value: data, excludeFromIndexes: true },
            { name: 'expiration', value: expireTime }
          ]
        });
      })
      .then(() => callback(true))
      .catch(() => callback(false));
  }

  // Get a file from a key
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    this.datastore()
      .then(async (datastore) => {
        const taskKey = datastore.key([this.kind, key]);
        const [entity] = await datastore.get(taskKey);

        if (!entity) return callback(false);

        if (skipExpire || entity['expiration'] === null || entity['expiration'] === undefined) {
          return callback(entity['value']);
        }

        // check for expiry
        if (entity['expiration'] < new Date()) {
          log.info(
            {
              key,
              expiration: entity['expiration'],
              check: new Date(0)
            },
            'document expired'
          );
          return callback(false);
        }

        // update expiry
        datastore
          .update({
            key: taskKey,
            data: [
              { name: 'value', value: entity['value'], excludeFromIndexes: true },
              { name: 'expiration', value: new Date(Date.now() + Number(this.expire) * 1000) }
            ]
          })
          .catch((error: unknown) => {
            log.error({ error: String(error) }, 'failed to update expiration');
          });

        return callback(entity['value']);
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'Error retrieving value from Google Datastore');
        callback(false);
      });
  }

  // Delete a key. Datastore deletes are idempotent: a key that was never
  // written resolves the same way.
  remove(key: string, callback: StoreCallback<boolean>): void {
    this.datastore()
      .then((datastore) => datastore.delete(datastore.key([this.kind, key])))
      .then(() => callback(true))
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'Error deleting value from Google Datastore');
        callback(false);
      });
  }
}
