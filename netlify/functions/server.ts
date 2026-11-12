import { handle } from '@hono/netlify';

import { createApp } from '../../src/http.js';
import type { CreatedApp } from '../../src/http.js';

// Netlify Functions invoke this per request. `@hono/netlify`'s `handle` takes a
// Web `Request` and returns a `Response`; it must not be called with a Lambda or
// Netlify event object.
//
// Storage on Netlify cannot be the file store; `createApp` refuses that
// combination at boot with an actionable message.
let appPromise: Promise<CreatedApp> | undefined;

const getApp = (): Promise<CreatedApp> => {
  appPromise ??= createApp(process.env.HASTE_CONFIG || 'config.js');
  return appPromise;
};

export const handler = async (request: Request, context: unknown): Promise<Response> => {
  const { app } = await getApp();
  return handle(app.fetch)(request, context);
};
