import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDocumentService } from '../dist/core.js';
import Generator from '../dist/lib/key_generators/random.js';

const DEFAULT_KEY_LENGTH = 10;

const quiet = { error() {}, warn() {}, info() {}, verbose() {}, debug() {}, silly() {} };

describe('document_handler', () => {
  describe('randomKey', () => {
    it('should choose a key of the proper length', async () => {
      const gen = new Generator();
      const service = createDocumentService(
        {
          get: (_key, callback) => callback(false),
          set: (_key, _data, callback) => callback(true)
        },
        { storage: { type: 'file' }, keyLength: 6 },
        gen,
        quiet
      );

      assert.equal((await service.chooseKey()).length, 6);
    });

    it('should choose a default key length', () => {
      const gen = new Generator();
      const service = createDocumentService(
        {
          get: (_key, callback) => callback(false),
          set: (_key, _data, callback) => callback(true)
        },
        { storage: { type: 'file' } },
        gen,
        quiet
      );

      return service.chooseKey().then((key) => {
        assert.equal(key.length, DEFAULT_KEY_LENGTH);
      });
    });
  });

  describe('chooseKey', () => {
    // A store whose get() reports every key as taken.
    const fullStore = (get) => ({ get, set: (_key, _data, callback) => callback(true) });

    it('should return a key the store reports as free', async () => {
      const store = fullStore((_key, callback) => callback(false));
      const service = createDocumentService(
        store,
        { storage: { type: 'file' }, keyLength: DEFAULT_KEY_LENGTH },
        new Generator(),
        quiet
      );

      assert.equal((await service.chooseKey()).length, DEFAULT_KEY_LENGTH);
    });

    it('should stop instead of recursing forever when the keyspace is full', async () => {
      let lookups = 0;
      const store = fullStore((_key, callback) => {
        lookups++;
        callback('taken');
      });
      const service = createDocumentService(
        store,
        { storage: { type: 'file' }, keyLength: DEFAULT_KEY_LENGTH },
        new Generator(),
        quiet
      );

      await assert.rejects(service.chooseKey(), /Unable to find an unused key/);
      assert.equal(lookups, 100);
    });

    it('should skip taken keys and return the first free one', async () => {
      let lookups = 0;
      const store = fullStore((_key, callback) => {
        lookups++;
        callback(lookups < 3 ? 'taken' : false);
      });
      const service = createDocumentService(
        store,
        { storage: { type: 'file' }, keyLength: DEFAULT_KEY_LENGTH },
        new Generator(),
        quiet
      );

      assert.equal(typeof (await service.chooseKey()), 'string');
      assert.equal(lookups, 3);
    });
  });
});
