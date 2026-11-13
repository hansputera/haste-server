import crypto from 'node:crypto';

import { deferred } from '../deferred.js';
import log from '../log.js';
import { loadModule } from '../optional-client.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of the official `rethinkdb` driver, which is an
// optional client only installed by deployments that select this store.
//
// The previous implementation used `rethinkdbdash`, which has had no release
// since 2022 and is not maintained by the RethinkDB project.
interface ReQLCursor<T> extends AsyncIterable<T> {
  toArray(): Promise<T[]>;
}
interface ReQLQuery<T> {
  run(connection: ReQLConnection): Promise<ReQLCursor<T> | T>;
}
interface ReQLTable {
  insert(document: unknown): ReQLQuery<unknown>;
  get(id: string): ReQLQuery<{ data?: string } | null>;
}
interface ReQLConnection {
  close(callback?: (error?: Error) => void): void;
  table(name: string): ReQLTable;
}
interface ReQLModule {
  connect(
    options: unknown,
    callback: (error: Error | null, connection: ReQLConnection) => void
  ): void;
}

const md5 = (str: string): string => {
  const md5sum = crypto.createHash('md5');
  md5sum.update(str);
  return md5sum.digest('hex');
};

// `rethinkdb` is imported lazily: a deployment that does not select this store
// never needs the package installed.
export default class RethinkDBStore implements DocumentStore {
  private readonly options: StorageOptions;
  private connectionPromise: Promise<ReQLConnection> | null = null;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.options = options;
    this.connectionPromise = null;
  }

  connection(): Promise<ReQLConnection> {
    if (!this.connectionPromise) {
      const options = this.options;

      this.connectionPromise = loadModule<{ default?: ReQLModule } & ReQLModule>('rethinkdb').then(
        (module) => {
          // The driver is CommonJS: the namespace's `default` carries `connect`.
          const rethink: ReQLModule = module.default ?? module;

          const { promise, resolve, reject } = deferred<ReQLConnection>();
          rethink.connect(
            {
              host: options.host || '127.0.0.1',
              port: Number(options.port) || 28015,
              db: options.db || 'haste',
              user: options.user || 'admin',
              password: options.password || ''
            },
            (error, connection) => (error ? reject(error) : resolve(connection))
          );
          return promise;
        }
      );
    }
    return this.connectionPromise;
  }

  // The driver returns a cursor for a table query; a point get returns the row.
  private static firstRow<T>(result: ReQLCursor<T> | T): Promise<T | null> {
    if (result && typeof (result as ReQLCursor<T>).toArray === 'function') {
      return (result as ReQLCursor<T>).toArray().then((rows) => rows[0] ?? null);
    }
    return Promise.resolve((result as T) ?? null);
  }

  set(key: string, data: string, callback: StoreCallback<boolean>): void {
    this.connection()
      .then(async (connection) => {
        const result = await connection
          .table('uploads')
          .insert({ id: md5(key), data })
          .run(connection);
        await RethinkDBStore.firstRow(result);
        callback(true);
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'failed to insert to table');
        callback(false);
      });
  }

  get(key: string, callback: StoreCallback<string | false>): void {
    this.connection()
      .then(async (connection) => {
        const result = await connection.table('uploads').get(md5(key)).run(connection);
        const row = await RethinkDBStore.firstRow(result);

        callback(row?.data ? row.data : false);
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'failed to read from table');
        callback(false);
      });
  }
}
