import { handle } from '@hono/vercel';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { prepareForServerless } from '../dist/http.js';
import type { CreatedApp } from '../dist/http.js';

// Vercel calls this handler per invocation and never listens, so the app is
// built once per instance and reused across requests.
//
// It imports the *compiled* app rather than the TypeScript source: Vercel's
// bundler rewrites relative specifiers from source files onto its own cache
// paths (`.vercel/output/functions/...`), and the app resolves `static/` and
// `openapi.json` from its own location — through `dist/` those paths are the
// package root, which `includeFiles` ships alongside.
//
// `@hono/vercel`'s `handle` is a Node request listener: it takes the
// `IncomingMessage`/`ServerResponse` pair Vercel's Node runtime passes.
let appPromise: Promise<CreatedApp> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  appPromise ??= prepareForServerless();
  const { app } = await appPromise;
  await handle(app.fetch)(request, response);
}
