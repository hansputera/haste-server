import path from 'node:path';

import type { Config } from './lib/types.js';
import { readEnvironment, SecretFileError, type EnvLayer } from './config/env-layer.js';
import { ConfigFileError, readConfigFile } from './config/file-layer.js';
import { redactConfig } from './config/redact.js';
import {
  CONFIG_FIELDS,
  CONFIG_PATH_ENV,
  type ConfigSource,
  type ResolvedConfig
} from './config/schema.js';
import { ConfigError, validate } from './config/validate.js';

// Configuration resolution.
//
// One order, no exceptions:
//
//   defaults  <  config file (plain JSON or SOPS-encrypted)  <  environment
//
// Inside the environment layer, `<NAME>_FILE` beats `<NAME>` (Docker/Kubernetes
// mount secrets as files) and the canonical `HASTE_*` name beats a legacy alias.
// The result carries provenance, so an operator can see which layer decided a
// value without guessing, and everything that leaves the process is masked.

export { ConfigError } from './config/validate.js';
export {
  CONFIG_FIELDS,
  ENV_NAMES,
  CONFIG_PATH_ENV,
  SOPS_ENV,
  NO_SOPS_ENV
} from './config/schema.js';
export type { ConfigSource, FieldDefinition, ResolvedConfig } from './config/schema.js';
export { redactConfig, MASK } from './config/redact.js';
export { validateConfig } from './config/validate.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep merge where the right-hand object wins; arrays are replaced wholesale. */
const merge = (base: unknown, overlay: unknown): unknown => {
  if (!isRecord(base) || !isRecord(overlay)) return overlay === undefined ? base : overlay;

  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = key in out ? merge(out[key], value) : value;
  }
  return out;
};

/** Every dotted leaf path of an object, used to attribute file values. */
const leafPaths = (value: unknown, prefix = ''): string[] => {
  if (!isRecord(value)) return prefix ? [prefix] : [];

  return Object.entries(value).flatMap(([key, entry]) => {
    const child = prefix ? `${prefix}.${key}` : key;
    return isRecord(entry) ? leafPaths(entry, child) : [child];
  });
};

export interface ResolveOptions {
  /** Explicit config path; wins over `HASTE_CONFIG`. */
  configPath?: string;
  /** Default config path when neither argument nor environment supplies one. */
  defaultPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Skip the file layer entirely (environment-only deployments). */
  withoutFile?: boolean;
}

/**
 * The config path for a process: explicit argument, then `HASTE_CONFIG`, then
 * the default. `null` means "no file layer" (`HASTE_CONFIG=` set to empty).
 */
export const resolveConfigPath = (
  argvPath: string | undefined,
  options: Pick<ResolveOptions, 'defaultPath' | 'env'> = {}
): string | null => {
  const env = options.env ?? process.env;
  if (argvPath) return argvPath;

  const fromEnv = env[CONFIG_PATH_ENV];
  if (fromEnv !== undefined) return fromEnv.trim() === '' ? null : fromEnv.trim();

  return options.defaultPath ?? 'config.js';
};

export const resolveConfig = (options: ResolveOptions = {}): ResolvedConfig => {
  const env = options.env ?? process.env;
  const configPath = options.withoutFile
    ? null
    : resolveConfigPath(options.configPath, { defaultPath: options.defaultPath, env });

  let envLayer: EnvLayer;
  try {
    envLayer = readEnvironment(env);
  } catch (error) {
    if (error instanceof SecretFileError) {
      throw new ConfigError([
        { key: 'config', detail: error.message, source: 'secret-file', env: error.variable }
      ]);
    }
    throw error;
  }

  // Layer 1 + 2: the file (possibly decrypted) is the base; its every leaf is
  // attributed to the file layer so validation can name the offender.
  let fileValue: unknown = {};
  let decrypted = false;

  if (configPath) {
    try {
      const file = readConfigFile(configPath, env);
      fileValue = file.value;
      decrypted = file.decrypted;
    } catch (error) {
      if (error instanceof ConfigFileError) {
        throw new ConfigError([
          {
            key: error.key,
            detail: error.message.replace(/^invalid config: config: /, ''),
            source: 'file'
          }
        ]);
      }
      throw error;
    }
  }

  const origins = new Map<string, ConfigSource>();
  for (const leaf of leafPaths(fileValue)) origins.set(leaf, 'file');
  for (const [key, source] of Object.entries(envLayer.sources)) origins.set(key, source);

  const merged = merge(merge({}, fileValue), envLayer.value);
  const { config, sources } = validate(merged, origins, env);

  // Defaults are attributed last, so only keys nothing else claimed are 'default'.
  const withDefaults: Record<string, ConfigSource> = {};
  for (const field of CONFIG_FIELDS) {
    withDefaults[field.path] = sources[field.path] ?? 'default';
  }

  return {
    config,
    sources: withDefaults,
    configPath: configPath ? path.normalize(configPath) : null,
    decrypted
  };
};

/** Resolve and return the config alone; throws `ConfigError` on any problem. */
export const loadConfig = (configPath?: string, env: NodeJS.ProcessEnv = process.env): Config =>
  resolveConfig({ configPath, env }).config;

/** A log-ready view of a resolved config: masked values, per-key provenance. */
export const describeResolvedConfig = (
  resolved: ResolvedConfig
): {
  configPath: string | null;
  decrypted: boolean;
  sources: Record<string, ConfigSource>;
  config: Record<string, unknown>;
} => ({
  configPath: resolved.configPath,
  decrypted: resolved.decrypted,
  sources: resolved.sources,
  config: redactConfig(
    resolved.config,
    new Set(CONFIG_FIELDS.filter((field) => field.secret).map((field) => field.path))
  )
});
