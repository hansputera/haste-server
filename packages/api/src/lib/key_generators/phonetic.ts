// Draws inspiration from pwgen and http://tools.arantius.com/password

const randOf = (collection: string): (() => string) => {
  return () => {
    return collection[Math.floor(Math.random() * collection.length)] as string;
  };
};

// Helper methods to get an random vowel or consonant
const randVowel = randOf('aeiou');
const randConsonant = randOf('bcdfghjklmnpqrstvwxyz');

export default class PhoneticKeyGenerator {
  // Generate a phonetic key of alternating consonant & vowel
  createKey(keyLength: number): string {
    let text = '';
    const start = Math.round(Math.random());

    for (let i = 0; i < keyLength; i++) {
      text += i % 2 === start ? randConsonant() : randVowel();
    }

    return text;
  }
}
