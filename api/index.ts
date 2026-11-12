import { handle } from '@hono/vercel';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApp } from '../src/http.js';
import type { CreatedApp } from '../src/http.js';

// Vercel calls this handler per invocation and never listens, so the app is
// built once per instance and reused across requests.
//
// `@hono/vercel`'s `handle` is a Node request listener: it takes the
// `IncomingMessage`/`ServerResponse` pair Vercel's Node runtime passes.
let appPromise: Promise<CreatedApp> | undefined;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  appPromise ??= createApp(process.env.HASTE_CONFIG || 'config.js');
  const { app } = await appPromise;
  await handle(app.fetch)(request, response);
}
