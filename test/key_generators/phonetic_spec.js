import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import Generator from '../../dist/lib/key_generators/phonetic.js';

const vowels = 'aeiou';
const consonants = 'bcdfghjklmnpqrstvwxyz';

describe('PhoneticKeyGenerator', () => {
  describe('generation', () => {
    it('should return a key of the proper length', () => {
      const gen = new Generator();
      assert.equal(gen.createKey(6).length, 6);
    });

    it('should alternate consonants and vowels', () => {
      const gen = new Generator();

      const key = gen.createKey(3);

      // if it starts with a consonant, we expect cvc
      // if it starts with a vowel, we expect vcv
      if (consonants.includes(key[0])) {
        assert.ok(consonants.includes(key[0]));
        assert.ok(consonants.includes(key[2]));
        assert.ok(vowels.includes(key[1]));
      } else {
        assert.ok(vowels.includes(key[0]));
        assert.ok(vowels.includes(key[2]));
        assert.ok(consonants.includes(key[1]));
      }
    });
  });
});
