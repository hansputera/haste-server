import fs from 'node:fs';

export default class DictionaryGenerator {
  private dictionary: string[] = [];
  private error?: NodeJS.ErrnoException;

  constructor(options: { path?: string }, readyCallback?: (error?: Error) => void) {
    // Check options format
    if (!options) throw Error('No options passed to generator');
    if (!options.path) throw Error('No dictionary path specified in options');

    // Load dictionary. A read error is recorded rather than thrown: throwing
    // from inside a callback would be an uncaught exception that takes the
    // process down with no way for a caller to react. `createKey` rethrows it
    // and the description is emitted at boot.
    fs.readFile(options.path, 'utf8', (err, data) => {
      if (err) {
        this.error = err;
        if (readyCallback) readyCallback(err);
        return;
      }

      this.dictionary = data.split(/[\n\r]+/);

      if (readyCallback) readyCallback();
    });
  }

  // Generates a dictionary-based key, of keyLength words
  createKey(keyLength: number): string {
    if (this.error) throw this.error;

    let text = '';

    for (let i = 0; i < keyLength; i++) {
      const index = Math.floor(Math.random() * this.dictionary.length);
      text += this.dictionary[index];
    }

    return text;
  }
}
