import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../dist/http.js';

// The spec is only useful if it describes what the router actually answers, so
// these assertions compare the checked-in document against live requests.

const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'openapi.json'), 'utf8'));

const required = (name) => spec.components.schemas[name].required;

describe('openapi contract', () => {
  let app;
  let tmpConfig;

  before(async () => {
    tmpConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haste-openapi-')), 'config.json');
    fs.writeFileSync(
      tmpConfig,
      JSON.stringify({
        storage: { type: 'file', path: './data' },
        keyGenerator: { type: 'random' }
      })
    );
    ({ app } = await createApp(tmpConfig));
  });

  after(() => {
    fs.rmSync(path.dirname(tmpConfig), { recursive: true, force: true });
  });

  it('should describe every route the app serves', () => {
    assert.deepEqual(Object.keys(spec.paths).sort(), [
      '/documents',
      '/documents/{id}',
      '/healthz',
      '/openapi.json',
      '/raw/{id}',
      '/readyz'
    ]);
  });

  it('should answer a missing document with the Error schema', async () => {
    const response = await app.request('/documents/zzzzzzzzzz');
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(Object.keys(body).sort(), [...required('Error')].sort());
  });

  it('should answer the liveness probe with the Status schema', async () => {
    const response = await app.request('/healthz');

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(await response.json()).sort(), [...required('Status')].sort());
  });

  it('should serve the document it describes', async () => {
    const response = await app.request('/openapi.json');

    assert.equal(response.status, 200);
    assert.equal((await response.json()).openapi, '3.1.0');
  });
});
