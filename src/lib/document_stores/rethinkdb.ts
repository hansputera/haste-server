import crypto from 'node:crypto';

import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of rethinkdbdash, which is an optional client only
// installed by deployments that select this store.
interface ReQLQuery {
  run(): Promise<unknown>;
}
interface ReQLTable {
  insert(document: unknown): ReQLQuery;
  get(id: string): ReQLQuery;
}
interface ReQLClient {
  table(name: string): ReQLTable;
}

const md5 = (str: string): string => {
  const md5sum = crypto.createHash('md5');
  md5sum.update(str);
  return md5sum.digest('hex');
};

// rethinkdbdash is imported lazily: a deployment that does not select this
// store never needs the package installed.
export default class RethinkDBStore implements DocumentStore {
  private readonly options: StorageOptions;
  private clientPromise: Promise<ReQLClient> | null = null;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.options = options;
    this.clientPromise = null;
  }

  client(): Promise<ReQLClient> {
    if (!this.clientPromise) {
      const options = this.options;

      this.clientPromise = loadModule<{
        default: (options: unknown) => ReQLClient;
      }>('rethinkdbdash', import.meta.url).then(({ default: rethink }) =>
        rethink({
          silent: true,
          host: options.host || '127.0.0.1',
          port: options.port || 28015,
          db: options.db || 'haste',
          user: options.user || 'admin',
          password: options.password || ''
        })
      );
    }
    return this.clientPromise;
  }

  set(key: string, data: string, callback: StoreCallback<boolean>): void {
    this.client()
      .then((client) =>
        client
          .table('uploads')
          .insert({ id: md5(key), data })
          .run()
      )
      .then(() => callback(true))
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'failed to insert to table');
        callback(false);
      });
  }

  get(key: string, callback: StoreCallback<string | false>): void {
    this.client()
      .then((client) => client.table('uploads').get(md5(key)).run())
      .then((result) => {
        const row = result as { data: string } | null;
        if (!row) return callback(false);
        callback(row.data);
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'failed to read from table');
        callback(false);
      });
  }
}
