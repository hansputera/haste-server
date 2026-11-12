import fs from 'node:fs';

import { ConfigFileError } from './file-layer.js';
import { CONFIG_FIELDS, type ConfigSource, type FieldDefinition } from './schema.js';

// The environment layer.
//
// Every field in the table has a canonical name (`HASTE_HOST`,
// `HASTE_STORAGE__TYPE`, `HASTE_RATE_LIMITS__CATEGORIES__NORMAL__EVERY`) and,
// where history demands it, legacy aliases (`PORT`, `STORAGE_TYPE`, …). The
// canonical name wins over the alias; a `<NAME>_FILE` variable wins over both,
// which is the Docker/k8s secrets convention: the platform mounts the secret as
// a file and the process never sees the value in its environment.

export interface EnvLayer {
  /** Sparse object shaped like the config file, holding only env-supplied keys. */
  value: Record<string, unknown>;
  sources: Record<string, ConfigSource>;
}

const setPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.');
  let cursor = target;

  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1] as string] = value;
};

const parseList = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseMap = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};

  for (const pair of parseList(raw)) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      throw new ConfigFileError(`env ${pair}`, `expected name=path, got ${JSON.stringify(pair)}`);
    }
    out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }

  return out;
};

// Error thrown when a mounted secret file cannot be read. It carries the
// variable name so the boot failure names the thing the operator must fix.
export class SecretFileError extends Error {
  readonly variable: string;

  constructor(variable: string, file: string, cause: unknown) {
    super(`cannot read ${file}: ${(cause as Error).message} (from ${variable}_FILE)`);
    this.name = 'SecretFileError';
    this.variable = `${variable}_FILE`;
  }
}

/** Read `<NAME>_FILE` when present. Empty content means "unset". */
const readSecretFile = (variable: string, env: NodeJS.ProcessEnv): string | undefined => {
  const file = env[`${variable}_FILE`];
  if (!file) return undefined;

  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    throw new SecretFileError(variable, file, error);
  }

  return content === '' ? undefined : content;
};

/** The raw value for a field, after `_FILE` indirection. */
const resolveRaw = (
  field: FieldDefinition,
  env: NodeJS.ProcessEnv
): { raw: string; source: ConfigSource } | undefined => {
  const fromFile = readSecretFile(field.env, env);
  if (fromFile !== undefined) return { raw: fromFile, source: 'secret-file' };

  const canonical = env[field.env];
  if (canonical !== undefined && canonical !== '') return { raw: canonical, source: 'env' };

  for (const legacy of field.legacyEnv ?? []) {
    const fromLegacyFile = readSecretFile(legacy, env);
    if (fromLegacyFile !== undefined) return { raw: fromLegacyFile, source: 'secret-file' };

    const value = env[legacy];
    if (value !== undefined && value !== '') return { raw: value, source: 'env' };
  }

  return undefined;
};

const coerce = (field: FieldDefinition, raw: string): unknown => {
  switch (field.kind) {
    case 'string':
      return raw;
    case 'port':
    case 'positive-int':
    case 'non-negative-int':
      // Left as text on purpose: the validator owns range checks, so one
      // message format covers file, env and secret-file values.
      return raw;
    case 'enum':
      return raw.trim();
    case 'string-list':
      return parseList(raw);
    case 'string-map':
      return parseMap(raw);
  }
};

/**
 * Build the environment layer for a config object.
 *
 * `documents` and the per-category rate limits are the only fields whose env
 * form is not a plain scalar; they are coerced here so the validator sees
 * exactly what it would see from a file.
 */
export const readEnvironment = (env: NodeJS.ProcessEnv = process.env): EnvLayer => {
  const value: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};

  for (const field of CONFIG_FIELDS) {
    const resolved = resolveRaw(field, env);
    if (!resolved) continue;

    setPath(value, field.path, coerce(field, resolved.raw));
    sources[field.path] = resolved.source;
  }

  return { value, sources };
};
