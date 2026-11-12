import log from '../log.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

// Minimal structural view of the `pg` pieces used here. `pg` is a declared
// dependency, but the pool is still built lazily so an unset DATABASE_URL only
// fails on the first query rather than at import time.
interface PgResult {
  rows: { id: number; value: string; expiration: number | null }[];
}
interface PgClient {
  query(sql: string, values?: unknown[]): Promise<PgResult>;
  release(): void;
}
interface PgPool {
  on(event: string, listener: (error: unknown) => void): void;
  connect(): Promise<PgClient>;
}

// create table entries (id serial primary key, key varchar(255) not null, value text not null, expiration int, unique(key));

export default class PostgresDocumentStore implements DocumentStore {
  private readonly expireJS: number;
  private readonly connectionString: string | undefined;
  private pool: PgPool | null = null;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.expireJS = parseInt(String(options.expire), 10);
    this.connectionString = process.env.DATABASE_URL || options.connectionUrl;
    this.pool = null;
  }

  poolClient(): Promise<PgPool> {
    if (!this.pool) {
      // pg is CommonJS; the namespace default carries the constructors.
      return import('pg').then((pg) => {
        this.pool = new pg.default.Pool({ connectionString: this.connectionString });
        this.pool.on('error', (error) => {
          log.error({ error: String(error) }, 'postgres pool error');
        });
        return this.pool;
      });
    }
    return Promise.resolve(this.pool);
  }

  // A connection wrapper
  async safeConnect(): Promise<{ client: PgClient; done: () => void }> {
    const pool = await this.poolClient();
    const client = await pool.connect();
    return { client, done: () => client.release() };
  }

  // Set a given key
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    const now = Math.floor(new Date().getTime() / 1000);

    this.safeConnect()
      .then(({ client, done }) =>
        client
          .query('INSERT INTO entries (key, value, expiration) VALUES ($1, $2, $3)', [
            key,
            data,
            this.expireJS && !skipExpire ? this.expireJS + now : null
          ])
          .then(() => done())
          .catch((error: unknown) => {
            done();
            throw error;
          })
      )
      .then(() => callback(true))
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'error persisting value to postgres');
        callback(false);
      });
  }

  // Get a given key's data
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    const now = Math.floor(new Date().getTime() / 1000);

    this.safeConnect()
      .then(async ({ client, done }) => {
        try {
          const result = await client.query(
            'SELECT id,value,expiration from entries where KEY = $1 and (expiration IS NULL or expiration > $2)',
            [key, now]
          );
          const row = result.rows[0];

          callback(row ? row.value : false);

          if (row && this.expireJS && !skipExpire) {
            await client.query('UPDATE entries SET expiration = $1 WHERE ID = $2', [
              this.expireJS + now,
              row.id
            ]);
          }
        } finally {
          done();
        }
      })
      .catch((error: unknown) => {
        log.error({ error: String(error) }, 'error retrieving value from postgres');
        callback(false);
      });
  }
}
