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

const getListener = async (): Promise<NodeRequestListener> => {
  if (!listener) {
    const { app } = await prepareForServerless();
    listener = getRequestListener(app.fetch);
  }
  return listener;
};

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const handle = await getListener();
  await handle(request, response);
}
