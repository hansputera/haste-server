import pino from 'pino';

import type { LoggingEntry } from './types.js';

// Structured logging.
//
// The config `logging` array is shaped like the old winston transport list:
// [{ level, type, colorize }]. The last recognised level wins; no configuration
// at all means 'info', which is today's default. `verbose` has no pino
// equivalent and maps to `debug` so an existing config keeps its gating.
export interface Logger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  verbose: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  silly: (obj: unknown, msg?: string) => void;
}

const LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'] as const;

export const levels: readonly string[] = LEVELS;

const toPinoLevel = (level: string): string => (level === 'verbose' ? 'debug' : level);

// Build a logger from the config `logging` array.
export const createLogger = (entries: LoggingEntry[] = []): Logger => {
  const requested = entries.length ? entries : [];
  let level = requested.length ? 'verbose' : 'info';

  for (const detail of requested) {
    if (detail && typeof detail.level === 'string' && levels.includes(detail.level)) {
      level = detail.level;
    }
  }

  const base = pino({
    level: toPinoLevel(level),
    base: { service: 'haste' },
    timestamp: pino.stdTimeFunctions.isoTime
  });

  // pino has no `verbose`/`silly` methods; both call `debug`.
  return {
    error: (obj, msg) => base.error(obj, msg),
    warn: (obj, msg) => base.warn(obj, msg),
    info: (obj, msg) => base.info(obj, msg),
    verbose: (obj, msg) => base.debug(obj, msg),
    debug: (obj, msg) => base.debug(obj, msg),
    silly: (obj, msg) => base.debug(obj, msg)
  };
};

// A logger with no configuration applied, for modules that log before or
// outside of the configured app.
const defaultLogger = createLogger();

export default defaultLogger;
