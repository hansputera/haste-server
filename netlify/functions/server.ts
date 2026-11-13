import type { CreatedApp } from '../../dist/http.js';
import { prepareForServerless } from '../../dist/http.js';

// Netlify Functions call this with a Web `Request` and expect a Web `Response`.
//
// `app.fetch(request)` is that mapping. `@hono/netlify`'s `handle` is exactly
// `(req, ctx) => app.fetch(req, { context })`, so it is inlined here instead of
// imported: the package is ESM-only, and Netlify's esbuild bundler emits the
// function as CommonJS, so an external `require('@hono/netlify')` fails at cold
// start with ERR_REQUIRE_ESM.
//
// `context` is passed through as Hono's `env`, which is where a Netlify v2
// function finds per-request bindings.
let appPromise: Promise<CreatedApp> | undefined;

const getApp = (): Promise<CreatedApp> => {
  // Vercel and Netlify both ship a per-invocation filesystem and no signal
  // handling; `prepareForServerless` marks the app ready for `/readyz`.
  appPromise ??= prepareForServerless(process.env.HASTE_CONFIG);
  return appPromise;
};

export default async function handler(request: Request, context: unknown): Promise<Response> {
  const { app } = await getApp();
  return app.fetch(request, { context });
}
