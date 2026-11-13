// Vercel's entry point for a project whose Root Directory is the repository
// root — the default when the repository is imported.
//
// Vercel only derives functions from the *project root's* `api/` directory, so
// this file has to exist here rather than inside `packages/api`; without it the
// build fails with `[BUILD_FAILED] No entrypoint found in "/vercel/path0"`.
//
// The adapter itself is `packages/api/api/index.ts`, which is type-checked by
// `check:deploy` and imports `../dist/http.js`. This file re-implements the same
// four lines against the compiled output rather than importing that source:
// a cross-package source import cannot satisfy both `NodeNext` (which demands a
// `.js` extension) and Node (where that `.js` does not exist, because nothing
// compiles the file). The compiled `dist/http.js` is plain JavaScript, so no
// declarations are needed on this side.
//
// Vercel transpiles this file without type-checking, and the deploy gate
// (`check:deploy`) covers the package copy, so the two cannot diverge silently
// in behaviour — the only duplicated logic is `getRequestListener(app.fetch)`.

import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { prepareForServerless } from '../packages/api/dist/http.js';

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
