import type { CreatedApp } from '../../dist/http.js';
import { prepareForServerless } from '../../dist/http.js';

// Netlify Functions call this with a Web `Request` and expect a Web `Response`.
//
// `app.fetch(request)` is that mapping. The adapter is inlined — it is one line
// — rather than imported: `@hono/netlify` is ESM-only, and Netlify's bundler has
// emitted this function as both CommonJS and ESM, so an external
// `require('@hono/netlify')` failed at cold start with ERR_REQUIRE_ESM.
//
// `context` is passed through as Hono's `env`, which is where a Netlify v2
// function finds per-request bindings.
let appPromise: Promise<CreatedApp> | undefined;

const getApp = (): Promise<CreatedApp> => {
  // Vercel and Netlify both ship a per-invocation filesystem and no signal
  // handling; `prepareForServerless` marks the app ready for `/readyz`.
  if (!appPromise) appPromise = prepareForServerless();
  return appPromise;
};

export default async function handler(request: Request, context: unknown): Promise<Response> {
  const { app } = await getApp();
  return app.fetch(request, { context });
}
