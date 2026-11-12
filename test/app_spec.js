import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildStaticIndex,
  createDocumentService,
  staticCacheControl,
  buildRateLimiter
} from '../dist/app.js';
import { deferred } from '../dist/lib/deferred.js';
import RandomKeyGenerator from '../dist/lib/key_generators/random.js';

const staticDir = path.join(process.cwd(), 'static');

describe('static index', () => {
  it('should expose every top-level static file as a slash-prefixed path', () => {
    const { files } = buildStaticIndex(staticDir);

    for (const expected of ['/index.html', '/application.js', '/logo.png']) {
      assert.ok(files.has(expected), `missing ${expected}`);
    }
  });

  it('should list every proper directory prefix as a token ancestor', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-static-'));

    try {
      fs.mkdirSync(path.join(fixture, 'nested'));
      fs.writeFileSync(path.join(fixture, 'nested', 'x.html'), '<p>x</p>');
      fs.writeFileSync(path.join(fixture, 'index.html'), '<p>root</p>');

      const { tokenAncestors } = buildStaticIndex(fixture);

      assert.ok(tokenAncestors.has('/nested'));
      assert.ok(!tokenAncestors.has('/'));
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe('staticCacheControl', () => {
  const index = buildStaticIndex(staticDir);

  it('should cache a fingerprinted asset for staticMaxAge', () => {
    assert.equal(staticCacheControl('/application.js', index), 'public, max-age=86400');
  });

  it('should revalidate the entry document', () => {
    assert.equal(staticCacheControl('/index.html', index), 'no-cache');
  });

  it('should honour an explicit maxAge', () => {
    assert.equal(staticCacheControl('/logo.png', index, 60), 'public, max-age=60');
  });
});

describe('createDocumentService', () => {
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
      }
    };
  };

  const config = (overrides = {}) => ({
    storage: { type: 'file' },
    keyLength: 10,
    ...overrides
  });

  const quiet = { error() {}, warn() {}, info() {}, verbose() {}, debug() {}, silly() {} };

  it('should strip a .ext suffix before looking a key up', async () => {
    const store = memoryStore({ abc: 'value' });
    const service = createDocumentService(store, config(), new RandomKeyGenerator(), quiet);

    const result = await service.getDocument('abc.js');

    assert.deepEqual(result, { found: true, data: 'value', key: 'abc' });
    assert.equal(store.calls[0].key, 'abc');
  });

  it('should not expire a seeded document', async () => {
    const store = memoryStore({ about: 'seed' });
    const service = createDocumentService(
      store,
      config({ documents: { about: './about.md' } }),
      new RandomKeyGenerator(),
      quiet
    );

    await service.getDocument('about');

    assert.equal(store.calls[0].skipExpire, true);
  });

  it('should report a body over maxLength without touching the store', async () => {
    const store = memoryStore();
    const service = createDocumentService(
      store,
      config({ maxLength: 4 }),
      new RandomKeyGenerator(),
      quiet
    );

    const result = await service.addDocument('12345');

    assert.deepEqual(result, { ok: false, reason: 'too-long' });
    assert.equal(store.calls.filter((call) => call.op === 'set').length, 0);
  });

  it('should stop after 100 taken keys', async () => {
    let lookups = 0;
    const store = {
      get(_key, callback) {
        lookups++;
        callback('taken');
      },
      set(_key, _data, callback) {
        callback(true);
      }
    };
    const service = createDocumentService(store, config(), new RandomKeyGenerator(), quiet);

    await assert.rejects(service.chooseKey(), /Unable to find an unused key/);
    assert.equal(lookups, 100);
  });

  it('should store a document under a fresh key', async () => {
    const store = memoryStore();
    const service = createDocumentService(store, config(), new RandomKeyGenerator(), quiet);

    const result = await service.addDocument('hello');

    assert.equal(result.ok, true);
    assert.equal(store.entries[result.key], 'hello');
  });
});

describe('buildRateLimiter', () => {
  const fakeResponse = () => {
    const headers = {};
    return {
      statusCode: 200,
      ended: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(name, value) {
        headers[name] = value;
      },
      end(body) {
        this.ended = body;
        this.onEnd?.();
      },
      headers
    };
  };

  it('should return null when no rate limits are configured', () => {
    assert.equal(buildRateLimiter(undefined), null);
  });

  it('should call next while under the limit', async () => {
    const limiter = buildRateLimiter({
      categories: { normal: { totalRequests: 2, every: 60000 } }
    });
    const response = fakeResponse();
    let nexted = false;

    await new Promise((resolve) => {
      limiter({ ip: '10.1.1.1' }, response, () => {
        nexted = true;
        resolve();
      });
    });

    assert.equal(nexted, true);
    assert.equal(response.ended, undefined);
  });

  it('should answer 429 once the limit is exhausted', async () => {
    const limiter = buildRateLimiter({
      categories: { normal: { totalRequests: 1, every: 60000 } }
    });
    const request = { ip: '10.9.9.9' };

    await new Promise((resolve) => limiter(request, fakeResponse(), resolve));

    // The exceed path ends the response instead of calling next, so the test
    // settles on `end`. Executor form because Node 20 has no withResolvers.
    const response = fakeResponse();
    const settled = deferred();
    response.onEnd = settled.resolve;
    limiter(request, response, () => {});
    await settled.promise;

    assert.equal(response.statusCode, 429);
    assert.deepEqual(JSON.parse(String(response.ended)), { message: 'Rate limit exceeded.' });
  });
});
