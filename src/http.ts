import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';

import Busboy from 'busboy';

import {
  buildRateLimiter,
  buildStaticIndex,
  createDocumentService,
  createKeyGenerator,
  createStore,
  seedDocuments,
  staticCacheControl,
  type DocumentService,
  type StaticIndex
} from './app.js';
import { describeResolvedConfig, resolveConfig } from './config.js';
import { deferred } from './lib/deferred.js';
import { createLogger, type Logger } from './lib/log.js';
import type { Config, DocumentStore } from './lib/types.js';

// The Hono application: middleware, routes and the JSON error contract.
//
// Middleware order is load-bearing. Request id and the access log come first so
// every line is correlatable; compression must precede anything that writes a
// body; cache headers are applied after `next()` so they see the final status;
// the health probes sit *before* `serveStatic`, which would otherwise resolve
// `/healthz` to `index.html`; `serveStatic` comes last.

const ROOT = new URL('../static/', import.meta.url).pathname;
// `serveStatic({ path })` requires an absolute path: a relative one (or a bare
// '/') is passed through untouched by the middleware.
const INDEX_FILE = join(ROOT, 'index.html');

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const openapiSpec: unknown = JSON.parse(
  readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')
);

export interface CreatedApp {
  app: Hono;
  config: Config;
  log: Logger;
  store: DocumentStore;
  index: StaticIndex;
  service: DocumentService;
  /** Flips readiness; called by the runtime on boot and during shutdown. */
  setReady: (ready: boolean) => void;
}

export const createApp = async (configPath?: string): Promise<CreatedApp> => {
  const resolved = resolveConfig({ configPath });
  const { config } = resolved;
  const log = createLogger(config.logging);

  // One masked line per boot: which layer decided each value, with secrets
  // already redacted. This is the record an operator reads after a rollout.
  log.info(describeResolvedConfig(resolved), 'config resolved');

  // A serverless filesystem is read-only and ephemeral, so the file store would
  // accept writes and silently lose every paste. Refuse at boot with an
  // actionable message rather than running with data loss.
  if ((process.env.VERCEL || process.env.NETLIFY) && config.storage.type === 'file') {
    throw new Error(
      'file storage is not available on serverless hosting; configure redis, ' +
        'postgres, mongo, memcached, s3, google-datastore or rethinkdb'
    );
  }

  const store = await createStore(config.storage);
  seedDocuments(store, config.documents, log);

  const keyGenerator = await createKeyGenerator(config.keyGenerator);
  const service = createDocumentService(store, config, keyGenerator, log);

  const index = buildStaticIndex(ROOT);
  const maxAge = config.staticMaxAge ?? 86400;

  let ready = false;

  const app = new Hono();

  // 2. Request id: propagate an inbound one, generate otherwise.
  app.use('*', requestId());

  // 3. One structured access-log line per request.
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    log.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round((performance.now() - started) * 100) / 100
      },
      'request'
    );
  });

  // 4. Security headers.
  app.use('*', secureHeaders({ xFrameOptions: 'SAMEORIGIN' }));

  // 5. Compression. gzip only: a re-encoding CDN downstream must never see a
  // `Content-Length` it can desync.
  app.use('*', compress({ encoding: 'gzip', threshold: 1024 }));

  // 6. Cache headers, applied after the response is produced.
  app.use('*', async (c, next) => {
    await next();
    if (!c.res || c.res.headers.has('cache-control')) return;

    const status = c.res.status;
    const isStaticFile = index.files.has(c.req.path) || c.req.path === '/';
    c.header(
      'cache-control',
      status === 200 && isStaticFile
        ? staticCacheControl(c.req.path === '/' ? '/index.html' : c.req.path, index, maxAge)
        : status === 404
          ? 'public, max-age=86400'
          : 'no-store'
    );
  });

  // 7. Probes and the API contract document. Registered before `serveStatic`.
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', (c) =>
    ready ? c.json({ status: 'ready' }) : c.json({ status: 'unavailable' }, 503)
  );
  app.get('/openapi.json', (c) => c.json(openapiSpec as Record<string, unknown>));

  // 8. Central error handler: HTTPExceptions keep their response, everything
  // else becomes an opaque 500 and the detail only ever reaches the log.
  app.onError((err, c) => {
    log.error(
      {
        requestId: c.get('requestId'),
        err: err.message,
        stack: err.stack
      },
      'unhandled'
    );

    if (err instanceof HTTPException) return err.getResponse();
    return c.json({ message: 'Internal Server Error' }, 500);
  });

  // 9. Rate limiting, when configured.
  const limiter = buildRateLimiter(config.rateLimits);
  if (limiter) {
    app.use('*', async (c, next) => {
      // `getConnInfo` needs the Node adaptor's environment (`c.env.incoming`);
      // `app.request(...)` in tests has none, so the peer is simply unknown
      // there and every such request shares the 'unknown' bucket.
      let address: string | undefined;
      try {
        address = (getConnInfo as (context: unknown) => { remote: { address?: string } })(c).remote
          .address;
      } catch {
        address = undefined;
      }

      const request = { ip: address, socket: { remoteAddress: address } };

      let handled = false;
      let responseStatus = 200;
      const { promise, resolve } = deferred<void>();

      const response = {
        status(code: number) {
          responseStatus = code;
          return this;
        },
        setHeader(name: string, value: string) {
          c.header(name, value);
        },
        end(body?: string) {
          handled = true;
          if (body !== undefined) c.res = c.newResponse(body, responseStatus as 429);
          resolve();
        }
      };

      limiter(request, response, () => resolve());
      await promise;

      // The limiter already wrote its own response.
      if (handled) return;
      await next();
    });
  }

  // 10. API routes. `app.on` covers HEAD so no method is undefined.
  const notFound = (c: Context): Response => c.json({ message: 'Document not found.' }, 404);

  app.on(['GET', 'HEAD'], '/documents/:id', async (c) => {
    const result = await service.getDocument(c.req.param('id'));
    if (!result.found) return notFound(c);

    if (c.req.method === 'HEAD') {
      return c.body(null, 200, { 'content-type': 'application/json' });
    }

    return c.json({ data: result.data, key: result.key });
  });

  app.on(['GET', 'HEAD'], '/raw/:id', async (c) => {
    const result = await service.getDocument(c.req.param('id'));
    if (!result.found) return notFound(c);

    if (c.req.method === 'HEAD') {
      return c.body(null, 200, { 'content-type': 'text/plain; charset=UTF-8' });
    }

    return c.body(result.data, 200, { 'content-type': 'text/plain; charset=UTF-8' });
  });

  // `bodyLimit` is a hard ceiling that never runs the handler: a body over it
  // is a 413. `onError` must not answer 413 itself, or a genuine oversize and
  // the maxLength contract below become indistinguishable.
  const hardLimit: MiddlewareHandler = bodyLimit({
    maxSize: MAX_UPLOAD_BYTES,
    onError: (c) => c.json({ message: 'Request body too large.' }, 413)
  });

  app.on(['POST', 'PUT'], '/documents', hardLimit, async (c) => {
    // The upload is read here rather than through `bodyLimit`: a body one byte
    // over maxLength is a *client* error with its own message and status, and
    // `bodyLimit` can only answer one shape for every oversize.
    const contentType = c.req.header('content-type') ?? '';
    const body =
      contentType.split(';')[0] === 'multipart/form-data'
        ? await readMultipart(c.req.raw.body, contentType)
        : await c.req.text();

    const result = await service.addDocument(body);
    if (result.ok) return c.json({ key: result.key });

    return result.reason === 'too-long'
      ? c.json({ message: 'Document exceeds maximum length.' }, 400)
      : c.json({ message: 'Error adding document.' }, 500);
  });

  // 11. Static assets, then the index fallback.
  //
  // The fallback is decided from the boot-time index, not from a per-request
  // filesystem probe: a path that is neither a static file nor a directory that
  // holds one is a paste token, so the index is served for it. A token ancestor
  // is left to serveStatic's own directory index.
  app.use('*', serveStatic({ root: ROOT, precompressed: true }));

  app.get('*', (c, next) => {
    const staticPath = c.req.path === '/' || index.files.has(c.req.path) ? c.req.path : INDEX_FILE;
    return serveStatic({ path: staticPath, precompressed: true })(c, next);
  });

  return {
    app,
    config,
    log,
    store,
    index,
    service,
    setReady(value: boolean) {
      ready = value;
    }
  };
};

// Read the paste payload from a multipart body.
//
// Only the `data` field is kept (busboy discards other fields), resolved on
// 'close', rejected on 'error'.
const readMultipart = async (
  body: ReadableStream<Uint8Array> | null,
  contentType: string
): Promise<string> => {
  if (!body) return '';

  const busboy = Busboy({ headers: { 'content-type': contentType } });
  const { promise, resolve, reject } = deferred<string>();
  let buffer = '';

  busboy.on('field', (fieldname: string, value: string) => {
    if (fieldname === 'data') buffer = value;
  });
  busboy.on('error', reject);
  busboy.on('close', () => resolve(buffer));

  Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(busboy);

  return promise;
};
