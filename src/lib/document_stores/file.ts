import fs from 'node:fs';
import crypto from 'node:crypto';

import { createLogger } from '../log.js';
import type { DocumentStore, StorageOptions, StoreCallback } from '../types.js';

const log = createLogger();

// For storing in files
// options[type] = file
// options[path] - Where to store

export default class FileDocumentStore implements DocumentStore {
  private readonly basePath: string;
  private readonly expire: number | string | false | undefined;

  constructor(options: StorageOptions, client?: unknown) {
    // Only redis takes a pre-built client; every other store builds its own.
    void client;
    this.basePath = options.path || './data';
    this.expire = options.expire;
  }

  // Generate md5 of a string
  static md5(str: string): string {
    const md5sum = crypto.createHash('md5');
    md5sum.update(str);
    return md5sum.digest('hex');
  }

  // Save data in a file, key as md5 - since we don't know what we could
  // be passed here
  set(key: string, data: string, callback: StoreCallback<boolean>, skipExpire?: boolean): void {
    const fn = this.basePath + '/' + FileDocumentStore.md5(key);

    fs.promises
      .mkdir(this.basePath, { recursive: true })
      .then(() => fs.promises.writeFile(fn, data, 'utf8'))
      .then(() => {
        callback(true);
        if (this.expire && !skipExpire) {
          log.warn({}, 'file store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }

  // Get data from a file from key
  get(key: string, callback: StoreCallback<string | false>, skipExpire: boolean): void {
    const fn = this.basePath + '/' + FileDocumentStore.md5(key);

    fs.promises
      .readFile(fn, 'utf8')
      .then((data) => {
        callback(data);
        if (this.expire && !skipExpire) {
          log.warn({}, 'file store cannot set expirations on keys');
        }
      })
      .catch(() => callback(false));
  }
}
