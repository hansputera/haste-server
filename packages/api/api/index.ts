import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { prepareForServerless } from '../dist/http.js';

// Vercel calls this handler per invocation and never listens, so the app is
// built once per instance and reused across requests.
//
// `getRequestListener` adapts a `fetch` handler to Node's
// `(IncomingMessage, ServerResponse)` pair, which is exactly what Vercel's Node
// runtime passes. `@hono/vercel`'s `handle` is **not** that adapter: it takes a
// `Hono` app and returns a Web `Request` listener, so calling it with the
// `(req, res)` pair fails to type-check and would not write a response.
//
// The compiled app is imported rather than the TypeScript source so `static/`
// and `openapi.json` resolve from the package root, which `includeFiles` ships.

/** The Node request listener `@hono/node-server` produces for a fetch handler. */
type NodeRequestListener = (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>;

let listener: NodeRequestListener | undefined;

/**
 * The adapter Vercel's Node runtime calls.
 *
 * Exported as a value so the repository-root entry (`/api/index.ts`, which
 * Vercel requires when Root Directory is the repository root) can delegate to
 * it without importing anything else: everything that needs this package's
 * dependencies stays on this side, where those dependencies resolve.
 */
export const nodeListener = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  if (!listener) {
    const { app } = await prepareForServerless();
    listener = getRequestListener(app.fetch);
  }
  await listener(request, response);
};

export default nodeListener;
