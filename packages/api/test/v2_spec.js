import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDocumentService } from '../dist/core.js';
import RandomKeyGenerator from '../dist/lib/key_generators/random.js';
import { parseRecord, serializeRecord, V2_MARKER } from '../dist/v2/record.js';
import { createV2Service } from '../dist/v2/service.js';
import { renderV2Page, OG_MARKER, OG_MARKER_END } from '../dist/v2/page.js';

const quiet = { error() {}, warn() {}, info() {}, verbose() {}, debug() {}, silly() {} };

const record = (overrides = {}) => ({
  version: 2,
  key: 'abcdefghij',
  title: 't',
  description: 'd',
  language: 'javascript',
  createdAt: '2026-01-01T00:00:00.000Z',
  burn: false,
  encrypted: false,
  body: 'hello',
  ...overrides
});

// A store shaped like every backend: callbacks, no promises.
const memoryStore = (initial = {}) => {
  const entries = { ...initial };
  const calls = [];

  return {
    calls,
    entries,
    get(key, callback, skipExpire) {
      calls.push({ op: 'get', key, skipExpire });
      callback(entries[key] ?? false);
    },
    set(key, data, callback) {
      calls.push({ op: 'set', key });
      entries[key] = data;
      callback(true);
    },
    remove(key, callback) {
      calls.push({ op: 'remove', key });
      const present = Object.hasOwn(entries, key);
      delete entries[key];
      callback(true, present);
    }
  };
};

const config = (overrides = {}) => ({ storage: { type: 'file' }, keyLength: 10, ...overrides });

const buildService = (store, overrides) =>
  createV2Service(
    store,
    createDocumentService(store, config(overrides), new RandomKeyGenerator(), quiet),
    config(overrides),
    quiet
  );

describe('v2 record', () => {
  it('should round-trip a plaintext record', () => {
    const value = record();
    assert.deepEqual(parseRecord(serializeRecord(value)), value);
  });

  it('should round-trip an encrypted record without a body', () => {
    const value = record({
      encrypted: true,
      body: undefined,
      cipher: { iv: 'aXY=', salt: 'c2FsdA==', iterations: 210000, data: 'ZGF0YQ==' }
    });
    const parsed = parseRecord(serializeRecord(value));

    assert.equal(parsed?.encrypted, true);
    assert.equal(parsed?.body, undefined);
    assert.deepEqual(parsed?.cipher, value.cipher);
  });

  it('should refuse a v1 body', () => {
    assert.equal(parseRecord('hello'), null);
  });

  it('should refuse a marked value that is not a v2 record', () => {
    assert.equal(parseRecord(`${V2_MARKER}{"version":3}`), null);
    assert.equal(parseRecord(`${V2_MARKER}not json`), null);
    // encrypted === true with no cipher is not a record we can ever return.
    assert.equal(parseRecord(`${V2_MARKER}{"version":2,"key":"a","encrypted":true}`), null);
  });
});

describe('v2 service', () => {
  it('should reject a create with neither body nor cipher', async () => {
    const service = buildService(memoryStore());
    assert.deepEqual(await service.create({ title: 't' }), { ok: false, reason: 'invalid' });
  });

  it('should reject a create with both body and cipher', async () => {
    const service = buildService(memoryStore());
    const result = await service.create({
      body: 'x',
      cipher: { iv: 'a', salt: 'b', iterations: 1, data: 'c' }
    });

    assert.deepEqual(result, { ok: false, reason: 'invalid' });
  });

  it('should reject a body over maxLength', async () => {
    const service = buildService(memoryStore(), { maxLength: 4 });
    assert.deepEqual(await service.create({ body: '12345' }), { ok: false, reason: 'too-long' });
  });

  it('should store a plaintext record under a fresh key and read it back', async () => {
    const store = memoryStore();
    const service = buildService(store);

    const created = await service.create({ title: 't', body: 'const x = 1;' });
    assert.equal(created.ok, true);

    const read = await service.read(created.key);
    assert.equal(read.ok, true);
    assert.equal(read.record.body, 'const x = 1;');
    assert.equal(read.record.title, 't');
    assert.equal(read.record.createdAt.length > 0, true);
  });

  it('should strip a .ext suffix before reading', async () => {
    const store = memoryStore();
    const service = buildService(store);

    const created = await service.create({ body: 'hi' });
    const read = await service.read(`${created.key}.js`);

    assert.equal(read.ok, true);
    assert.equal(store.calls.at(-1).key, created.key);
  });

  it('should remove a burn record exactly once and answer not-found afterwards', async () => {
    const store = memoryStore();
    const service = buildService(store);

    const created = await service.create({ body: 'secret', burn: true });
    const first = await service.read(created.key);

    assert.equal(first.ok, true);
    assert.equal(first.record.body, 'secret');
    assert.deepEqual(
      store.calls.filter((call) => call.op === 'remove'),
      [{ op: 'remove', key: created.key }]
    );

    assert.deepEqual(await service.read(created.key), { ok: false, reason: 'not-found' });
  });

  it('should still return a burn record when the delete fails', async () => {
    const store = memoryStore();
    store.remove = (_key, callback) => callback(false);
    const service = buildService(store);

    const created = await service.create({ body: 'secret', burn: true });
    const read = await service.read(created.key);

    assert.equal(read.ok, true);
    assert.equal(read.record.burn, true);
  });

  it('should answer not-found for a v1 body stored under the same key', async () => {
    const service = buildService(memoryStore({ abcdefghij: 'plain v1 text' }));
    assert.deepEqual(await service.read('abcdefghij'), { ok: false, reason: 'not-found' });
  });

  it('should treat remove as idempotent', async () => {
    const store = memoryStore();
    const service = buildService(store);

    await service.remove('nope');
    await service.remove('nope');

    assert.equal(store.calls.filter((call) => call.op === 'remove').length, 2);
  });

  it('should not consume a burn record through peek', async () => {
    const store = memoryStore();
    const service = buildService(store);

    const created = await service.create({ body: 'preview only', burn: true });

    const peeked = await service.peek(created.key);
    assert.equal(peeked.ok, true);
    assert.equal(
      store.calls.filter((call) => call.op === 'remove').length,
      0,
      'peek must never delete'
    );

    // The consuming read is still the one that burns it.
    assert.equal((await service.read(created.key)).ok, true);
    assert.deepEqual(await service.peek(created.key), { ok: false, reason: 'not-found' });
  });
});

describe('v2 page', () => {
  const shell =
    '<!doctype html><html><head>' +
    OG_MARKER +
    '<title>haste</title>' +
    OG_MARKER_END +
    '</head><body></body></html>';

  it('should inject og:image for a public paste', () => {
    const html = renderV2Page(shell, {
      title: 't',
      description: 'd',
      imageUrl: '/v2/og/abcdefghij.png',
      url: '/v2/abcdefghij'
    });

    assert.match(html, /<meta property="og:image" content="\/v2\/og\/abcdefghij\.png"\/>/);
    assert.match(html, /og:image:width" content="1200"/);
    assert.match(html, /og:image:height" content="630"/);
    assert.match(html, /<title>t<\/title>/);
    assert.ok(!html.includes(OG_MARKER + '<title>haste</title>'));
  });

  it('should replace the shell defaults rather than duplicate them', () => {
    const html = renderV2Page(shell, {
      title: 'real title',
      description: 'real description',
      imageUrl: null,
      url: '/v2/x'
    });

    assert.equal((html.match(/<title>/g) ?? []).length, 1, 'exactly one <title>');
    assert.ok(!html.includes('Private pastebin'), 'the shell default must be gone');
    assert.ok(html.includes('<title>real title</title>'));
  });

  it('should omit every og:image tag when imageUrl is null', () => {
    const html = renderV2Page(shell, {
      title: 'secret',
      description: '',
      imageUrl: null,
      url: '/v2/abcdefghij'
    });

    assert.ok(!html.includes('og:image'));
    assert.ok(html.includes('og:title'));
  });

  it('should escape a title that would otherwise close the tag', () => {
    const html = renderV2Page(shell, {
      title: '</title><script>',
      description: '"',
      imageUrl: null,
      url: '/v2/x'
    });

    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;\/title&gt;/);
  });

  it('should leave a shell with no marker untouched', () => {
    assert.equal(
      renderV2Page('<html></html>', {
        title: 't',
        description: '',
        imageUrl: null,
        url: '/'
      }),
      '<html></html>'
    );
  });
});

describe('v2 storage', () => {
  it('should write and delete through the file store', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-v2-'));
    const { default: FileDocumentStore } = await import('../dist/lib/document_stores/file.js');
    const store = new FileDocumentStore({ type: 'file', path: dir });

    try {
      await new Promise((resolve) => store.set('abc', 'value', resolve));
      assert.equal(fs.readdirSync(dir).length, 1);

      await new Promise((resolve) => store.remove('abc', resolve));
      assert.deepEqual(fs.readdirSync(dir), []);

      // Removing a key that is already gone is success, not an error.
      const again = await new Promise((resolve) => store.remove('abc', resolve));
      assert.equal(again, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // `types.ts` makes `remove` part of the contract, so a store that forgot it
  // would fail `tsc`. This asserts the runtime shape too, because the stores are
  // loaded by a string-named dynamic import.
  it('should give every store a remove method', async () => {
    const names = [
      'amazon-s3',
      'file',
      'google-datastore',
      'memcached',
      'mongo',
      'postgres',
      'redis',
      'rethinkdb'
    ];

    for (const name of names) {
      const module = await import(`../dist/lib/document_stores/${name}.js`);
      assert.equal(
        typeof module.default.prototype.remove,
        'function',
        `${name} store has no remove()`
      );
    }
  });
});
