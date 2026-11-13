import { createAdaptorServer } from '@hono/node-server';

import { createApp } from './http.js';
import type { Logger } from './lib/log.js';

// Process lifecycle: build the app, bind a listener on Node or Bun, and drain
// in-flight work on SIGTERM/SIGINT. This module is the only place that decides
// how the process stops.

// Bun's `serve` is not part of @types/node and @types/bun is not a dependency.
declare const Bun: { serve(options: unknown): BunServer } | undefined;

interface BunServer {
  close(): Promise<void> | void;
}

interface DrainableServer {
  close(callback?: (error?: Error) => void): unknown;
}

export interface ShutdownOptions {
  server: DrainableServer;
  log: Logger;
  setReady: (ready: boolean) => void;
  drainMs?: number;
  exit?: (code: number) => void;
}

const SERVERLESS = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.SERVERLESS);

export const installShutdown = ({
  server,
  log,
  setReady,
  drainMs = 10_000,
  exit = (code) => process.exit(code)
}: ShutdownOptions): (() => void) => {
  // A function runtime owns its own lifecycle; adding handlers there would
  // fight the platform.
  if (SERVERLESS) return () => {};

  let draining = false;

  const shutdown = (signal: string): void => {
    if (draining) {
      // A second signal during the drain means "now".
      log.warn({ signal }, 'shutting down immediately');
      exit(1);
      return;
    }

    draining = true;
    log.info({ signal }, 'shutting down');
    setReady(false);

    const timer = setTimeout(() => {
      log.error({ drainMs }, 'drain timed out');
      exit(1);
    }, drainMs);
    timer.unref();

    const finish = (error?: Error): void => {
      clearTimeout(timer);
      if (error) {
        log.error({ error: String(error) }, 'error while closing server');
        exit(1);
        return;
      }
      exit(0);
    };

    try {
      server.close((error?: Error) => finish(error));
    } catch (error) {
      finish(error as Error);
    }
  };

  const handlers: [NodeJS.Signals, (signal: NodeJS.Signals) => void][] = [
    ['SIGTERM', shutdown],
    ['SIGINT', shutdown]
  ];

  for (const [signal, handler] of handlers) process.once(signal, handler);

  return () => shutdown('MANUAL');
};

// `configPath` is omitted when the process runs from the environment alone.
export const start = async (configPath?: string): Promise<unknown> => {
  const created = await createApp(configPath);
  const { app, config, log } = created;

  const port = Number(config.port) || 7777;
  const host = String(config.host ?? '0.0.0.0');

  let server: DrainableServer;

  if (typeof Bun !== 'undefined') {
    server = Bun.serve({ port, hostname: host, fetch: app.fetch, idleTimeout: 0 });
    log.info({ host, port }, `listening on ${host}:${port}`);
  } else {
    const nodeServer = createAdaptorServer({ fetch: app.fetch });
    nodeServer.listen(port, host, () => log.info({ host, port }, `listening on ${host}:${port}`));
    server = nodeServer;
  }

  installShutdown({ server, log, setReady: created.setReady });
  created.setReady(true);

  return server;
};
