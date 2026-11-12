import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Generator from '../../dist/lib/key_generators/dictionary.js';

describe('DictionaryGenerator', function () {
  describe('options', function () {
    it('should throw an error if given no options', () => {
      assert.throws(() => {
        new Generator();
      }, Error);
    });

    it('should throw an error if given no path', () => {
      assert.throws(() => {
        new Generator({});
      }, Error);
    });
  });
  describe('generation', function () {
    it('should return a key of the proper number of words from the given dictionary', function () {
      return new Promise((resolve, reject) => {
        const file = path.join(os.tmpdir(), 'haste-server-test-dictionary');
        const words = ['cat'];
        fs.writeFileSync(file, words.join('\n'));

        const gen = new Generator({ path: file }, () => {
          try {
            assert.equal(gen.createKey(3), 'catcatcat');
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    });
  });
});
