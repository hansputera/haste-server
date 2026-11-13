import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildStaticIndex,
  createDeferredFileStore,
  createDocumentService,
  createStore,
  seedDocuments,
  staticCacheControl,
  buildRateLimiter
} from '../dist/core.js';
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

describe('serverless storage', () => {
  it('should defer constructing the file store until the first read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-deferred-'));
    const store = await createStore({ type: 'file', path: dir }, true);

    // Nothing has touched the filesystem yet: this is what makes a runtime
    // whose filesystem only exists inside an invocation workable.
    assert.deepEqual(fs.readdirSync(dir), []);

    const stored = await new Promise((resolve) => store.set('abc', 'deferred', resolve));
    assert.equal(stored, true);
    assert.deepEqual(fs.readdirSync(dir).length, 1);

    const read = await new Promise((resolve) => store.get('abc', resolve, false));
    assert.equal(read, 'deferred');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should answer a miss instead of throwing when the store cannot be built', async () => {
    const store = createDeferredFileStore({ type: 'no-such-store' });
    const result = await new Promise((resolve) => store.get('abc', resolve, false));
    assert.equal(result, false);
  });

  it('should resolve seeded document paths against the given root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-seed-'));
    fs.writeFileSync(path.join(root, 'about.md'), '# seeded', 'utf8');

    const writes = [];
    const store = {
      get: () => {},
      set: (key, data, callback) => {
        writes.push([key, data]);
        callback(true);
      }
    };

    // The working directory is deliberately unrelated to the root.
    seedDocuments(store, { about: './about.md' }, undefined, root);
    assert.deepEqual(writes, [['about', '# seeded']]);

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('bundled deployment', () => {
  // Netlify emits this function as an ES module. esbuild inlines any dependency
  // it can resolve, and an inlined CommonJS package that calls `require('tty')`
  // or `require('stream')` throws "Dynamic require ... is not supported" at cold
  // start. Every runtime dependency is therefore external.
  it('should externalise every runtime dependency of the Netlify bundle', async () => {
    const netlifyToml = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');

    const externals = (netlifyToml.match(/external_node_modules = \[([^\]]*)\]/) ?? [null, ''])[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);

    assert.ok(externals.length > 0, 'netlify.toml declares no externals');

    // Only what the Netlify function can reach: `@hono/vercel` is the Vercel
    // handler's adapter and is never imported by this bundle.
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const reachable = Object.keys(pkg.dependencies).filter((name) => name !== '@hono/vercel');
    const inlined = reachable.filter((name) => !externals.includes(name));

    assert.deepEqual(
      inlined,
      [],
      'these are not externalised; esbuild will inline them and their requires will throw'
    );
  });

  it('should resolve static assets from the application root, not import.meta.url', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'src', 'http.ts'), 'utf8');

    assert.ok(
      !/new URL\([^)]*import\.meta\.url/.test(spec),
      'src/http.ts must not derive asset paths from import.meta.url'
    );
  });

  it('should keep vercel.json to properties Vercel accepts together', () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));

    // Without this, Vercel auto-detects a Node server and runs src/server.ts,
    // which needs config.js and binds a port. `null` selects "Other".
    assert.equal(
      config.framework,
      null,
      'vercel.json must set "framework": null so api/index.ts is the only entry'
    );

    // "The functions property cannot be used in combination with builds" —
    // Vercel rejects the deployment outright.
    assert.ok(
      !('builds' in config && 'functions' in config),
      'vercel.json pairs builds with functions; Vercel rejects that combination'
    );

    // `routes` belongs to the legacy `builds` mechanism; `rewrites` is its
    // replacement and cannot be mixed with it.
    assert.ok(
      !('routes' in config && 'rewrites' in config),
      'vercel.json mixes legacy routes with rewrites'
    );

    // A function at api/index.ts answers at /api/index.
    for (const rule of config.rewrites ?? []) {
      assert.equal(rule.destination, '/api/index');
    }
  });

  it('should boot a serverless app with no config file present', async () => {
    // A function bundle ships no config.js. Before this was handled, every
    // invocation failed with "invalid config: config: cannot read config.js".
    const { prepareForServerless } = await import('../dist/http.js');

    const saved = {
      HASTE_CONFIG: process.env.HASTE_CONFIG,
      HASTE_STORAGE__TYPE: process.env.HASTE_STORAGE__TYPE,
      HASTE_STORAGE__PATH: process.env.HASTE_STORAGE__PATH
    };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-noconfig-'));
    delete process.env.HASTE_CONFIG;
    process.env.HASTE_STORAGE__TYPE = 'file';
    process.env.HASTE_STORAGE__PATH = dir;

    try {
      const created = await prepareForServerless();
      const ready = await created.app.request('/readyz');

      assert.equal(ready.status, 200);
      assert.equal(created.config.storage.type, 'file');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
