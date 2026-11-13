import type { Config, LoggingEntry, RateLimitCategory, StorageOptions } from '../lib/types.js';
import {
  CONFIG_FIELDS,
  DEFAULTS,
  FIELD_BY_PATH,
  KEY_GENERATOR_TYPES,
  STORE_TYPES,
  type ConfigSource,
  type FieldDefinition
} from './schema.js';

// Validation with two properties the boot path depends on:
//
// 1. Every problem is reported at once, not the first one. An operator running
//    `kubectl rollout` gets the complete list, not one key per attempt.
// 2. Each value remembers where it came from, so `port: must be an integer`
//    says "from env HASTE_PORT" instead of leaving the operator to guess
//    whether the file or the environment is at fault.
//
// The message format stays `invalid config: <key>: <detail>` on the first line;
// additional findings follow, one per line, so existing greps keep matching.

export interface ConfigIssue {
  key: string;
  detail: string;
  source: ConfigSource | 'unknown';
  env?: string;
}

export class ConfigError extends Error {
  readonly key: string;
  readonly issues: readonly ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    const [first] = issues;
    const head = `invalid config: ${first?.key ?? 'config'}: ${first?.detail ?? 'invalid'}`;
    const rest = issues.slice(1).map((issue) => `invalid config: ${issue.key}: ${issue.detail}`);

    super([head, ...rest].join('\n'));
    this.name = 'ConfigError';
    this.key = first?.key ?? 'config';
    this.issues = issues;
  }

  /** One line per finding, with provenance, for a log record. */
  toLogObject(): { issues: { key: string; detail: string; source: string; env?: string }[] } {
    return {
      issues: this.issues.map((issue) => ({
        key: issue.key,
        detail: issue.detail,
        source: issue.source,
        ...(issue.env ? { env: issue.env } : {})
      }))
    };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getPath = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, part) => (isRecord(node) ? node[part] : undefined), value);

/** Shallowest object holding `path`, so env names can be reported. */
const findField = (path: string): FieldDefinition | undefined => FIELD_BY_PATH.get(path);

class Collector {
  readonly issues: ConfigIssue[] = [];
  readonly sources: Record<string, ConfigSource> = {};

  constructor(
    private readonly origin: ReadonlyMap<string, ConfigSource>,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  /** Where a value came from; 'unknown' means nothing supplied it (a bug). */
  sourceOf(path: string): ConfigSource | 'unknown' {
    return this.origin.get(path) ?? (DEFAULTS[path] !== undefined ? 'default' : 'unknown');
  }

  noteFrom(path: string): void {
    const source = this.sourceOf(path);
    if (source !== 'unknown') this.sources[path] = source;
  }

  fail(path: string, detail: string): void {
    const field = findField(path);
    const source = this.sourceOf(path);
    this.issues.push({
      key: path,
      detail,
      source,
      ...(source === 'env' || source === 'secret-file'
        ? { env: this.envFor(field, path, source) }
        : {})
    });
  }

  /** The variable that actually supplied the value, for the error message. */
  private envFor(field: FieldDefinition | undefined, path: string, source: ConfigSource): string {
    if (!field) return path.toUpperCase().replace(/\./g, '__');
    const candidates = source === 'secret-file' ? [`${field.env}_FILE`] : [field.env];
    const legacy = (field.legacyEnv ?? []).flatMap((name) => [name, `${name}_FILE`]);
    for (const name of [...candidates, ...legacy]) {
      if (this.env[name] !== undefined) return name;
    }
    return field.env;
  }

  int(path: string, raw: unknown, { min, max }: { min: number; max?: number }): number | undefined {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());

    if (!Number.isInteger(value)) {
      this.fail(path, `must be an integer (got ${JSON.stringify(raw)})`);
      return undefined;
    }
    if (value < min) {
      this.fail(path, `must be >= ${min} (got ${value})`);
      return undefined;
    }
    if (max !== undefined && value > max) {
      this.fail(path, `must be <= ${max} (got ${value})`);
      return undefined;
    }

    this.noteFrom(path);
    return value;
  }

  string(path: string, raw: unknown): string | undefined {
    if (typeof raw !== 'string' || raw.trim() === '') {
      this.fail(path, 'must be a non-empty string');
      return undefined;
    }
    this.noteFrom(path);
    return raw;
  }

  enum(path: string, raw: unknown, values: readonly string[]): string | undefined {
    if (typeof raw !== 'string' || !values.includes(raw)) {
      this.fail(path, `must be one of ${values.join(', ')} (got ${JSON.stringify(raw)})`);
      return undefined;
    }
    this.noteFrom(path);
    return raw;
  }

  stringList(path: string, raw: unknown): string[] {
    if (raw === undefined || raw === null) {
      this.noteFrom(path);
      return [];
    }
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
      this.fail(path, 'must be an array of strings');
      return [];
    }
    this.noteFrom(path);
    return raw as string[];
  }
}

const withDefault = <T>(path: string, value: T): T =>
  value === undefined ? (DEFAULTS[path] as T) : value;

/** The scalar section of the config, validated field by field. */
const validateScalars = (
  raw: Record<string, unknown>,
  collector: Collector
): Partial<Config> & Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  out['host'] = collector.string('host', getPath(raw, 'host') ?? DEFAULTS['host']);
  out['port'] = collector.int('port', getPath(raw, 'port') ?? DEFAULTS['port'], {
    min: 1,
    max: 65535
  });
  out['keyLength'] = collector.int(
    'keyLength',
    getPath(raw, 'keyLength') ?? DEFAULTS['keyLength'],
    { min: 1 }
  );
  out['maxLength'] = collector.int(
    'maxLength',
    getPath(raw, 'maxLength') ?? DEFAULTS['maxLength'],
    { min: 1 }
  );
  out['staticMaxAge'] = collector.int(
    'staticMaxAge',
    getPath(raw, 'staticMaxAge') ?? DEFAULTS['staticMaxAge'],
    { min: 0 }
  );

  return out;
};

const validateStorage = (raw: Record<string, unknown>, collector: Collector): StorageOptions => {
  const storageRaw = getPath(raw, 'storage') ?? {};
  if (!isRecord(storageRaw)) {
    collector.fail('storage', 'must be an object');
    return { type: 'file' };
  }

  const type = collector.enum(
    'storage.type',
    storageRaw['type'] ?? DEFAULTS['storage.type'],
    STORE_TYPES
  );

  const storage: StorageOptions = { ...storageRaw, type: type ?? 'file' };

  const port = getPath(raw, 'storage.port');
  if (port !== undefined)
    storage.port = collector.int('storage.port', port, { min: 1, max: 65535 });
  const expire = getPath(raw, 'storage.expire');
  if (expire !== undefined && expire !== false) {
    storage.expire = collector.int('storage.expire', expire, { min: 1 });
  }

  for (const key of [
    'path',
    'host',
    'db',
    'bucket',
    'region',
    'user',
    'password',
    'connectionUrl'
  ]) {
    const value = getPath(raw, `storage.${key}`);
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value !== 'string') {
        collector.fail(`storage.${key}`, 'must be a string');
      } else {
        collector.noteFrom(`storage.${key}`);
      }
    } else if (typeof storage[key] === 'number') {
      storage[key] = String(storage[key]);
    }
  }

  return storage;
};

const validateKeyGenerator = (
  raw: Record<string, unknown>,
  collector: Collector
): Config['keyGenerator'] => {
  const rawGenerator = getPath(raw, 'keyGenerator') ?? {};
  if (!isRecord(rawGenerator)) {
    collector.fail('keyGenerator', 'must be an object');
    return { type: 'random' };
  }

  const type =
    collector.enum(
      'keyGenerator.type',
      rawGenerator['type'] ?? DEFAULTS['keyGenerator.type'],
      KEY_GENERATOR_TYPES
    ) ?? 'random';

  const path = getPath(raw, 'keyGenerator.path') ?? rawGenerator['path'];
  const keyspace = getPath(raw, 'keyGenerator.keyspace') ?? rawGenerator['keyspace'];

  if (path !== undefined && path !== null && typeof path !== 'string') {
    collector.fail('keyGenerator.path', 'must be a string');
  }
  if (keyspace !== undefined && keyspace !== null && typeof keyspace !== 'string') {
    collector.fail('keyGenerator.keyspace', 'must be a string');
  }
  if (type === 'dictionary' && (typeof path !== 'string' || path === '')) {
    collector.fail('keyGenerator.path', 'is required when keyGenerator.type is dictionary');
  }
  if (type !== 'dictionary') collector.noteFrom('keyGenerator.type');

  return {
    ...rawGenerator,
    type,
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof keyspace === 'string' ? { keyspace } : {})
  };
};

const validateLogging = (raw: Record<string, unknown>, collector: Collector): LoggingEntry[] => {
  const level = getPath(raw, 'logging.level');

  if (level !== undefined) {
    const parsed = collector.enum('logging.level', level, [
      'error',
      'warn',
      'info',
      'verbose',
      'debug',
      'silly'
    ]);
    return parsed ? [{ level: parsed }] : [];
  }

  const loggingRaw = getPath(raw, 'logging');
  if (loggingRaw === undefined || loggingRaw === null) return [];

  if (!Array.isArray(loggingRaw)) {
    collector.fail('logging', 'must be an array of { level } objects, or set logging.level');
    return [];
  }

  return loggingRaw.filter(isRecord) satisfies LoggingEntry[];
};

const validateDocuments = (
  raw: Record<string, unknown>,
  collector: Collector
): Record<string, string> => {
  const documentsRaw = getPath(raw, 'documents');
  if (documentsRaw === undefined || documentsRaw === null) return {};

  if (!isRecord(documentsRaw)) {
    collector.fail('documents', 'must be an object of name to path');
    return {};
  }

  const documents: Record<string, string> = {};
  for (const [name, value] of Object.entries(documentsRaw)) {
    if (typeof value !== 'string' || value === '') {
      collector.fail(`documents.${name}`, 'must be a path');
      continue;
    }
    documents[name] = value;
  }

  if (Object.keys(documents).length > 0) collector.noteFrom('documents');
  return documents;
};

const category = (
  prefix: 'normal' | 'whitelist' | 'blacklist',
  raw: Record<string, unknown>,
  collector: Collector,
  fallback?: RateLimitCategory
): RateLimitCategory | null | undefined => {
  const totalPath = `rateLimits.categories.${prefix}.totalRequests`;
  const everyPath = `rateLimits.categories.${prefix}.every`;

  const total = getPath(raw, totalPath);
  const every = getPath(raw, everyPath);

  const hasTotal = total !== undefined && total !== null && total !== '';
  const hasEvery = every !== undefined && every !== null && every !== '';

  // An incomplete category means "not configured" (the Docker entrypoint writes
  // every key): a partial one is dropped rather than limiting every client.
  if (!hasTotal && !hasEvery) return fallback;

  if (!hasTotal) {
    collector.fail(totalPath, 'must be a positive integer when the category is configured');
    return undefined;
  }
  if (!hasEvery) {
    collector.fail(everyPath, 'must be a positive integer when the category is configured');
    return undefined;
  }

  const totalRequests = collector.int(totalPath, total, { min: 1 });
  const everyMs = collector.int(everyPath, every, { min: 1 });
  if (totalRequests === undefined || everyMs === undefined) return undefined;

  return { totalRequests, every: everyMs };
};

const validateRateLimits = (
  raw: Record<string, unknown>,
  collector: Collector
): Config['rateLimits'] => {
  const rawRateLimits = getPath(raw, 'rateLimits');
  if (rawRateLimits === undefined || rawRateLimits === null) return undefined;

  if (!isRecord(rawRateLimits)) {
    collector.fail('rateLimits', 'must be an object');
    return undefined;
  }

  const categoriesRaw = rawRateLimits['categories'] ?? {};
  if (!isRecord(categoriesRaw)) {
    collector.fail('rateLimits.categories', 'must be an object');
    return undefined;
  }

  const normalFallback: RateLimitCategory = {
    totalRequests: DEFAULTS['rateLimits.categories.normal.totalRequests'] as number,
    every: DEFAULTS['rateLimits.categories.normal.every'] as number
  };

  return {
    whitelist: collector.stringList('rateLimits.whitelist', rawRateLimits['whitelist']),
    blacklist: collector.stringList('rateLimits.blacklist', rawRateLimits['blacklist']),
    categories: {
      normal: category('normal', raw, collector, normalFallback) ?? normalFallback,
      whitelist: category('whitelist', raw, collector) ?? null,
      blacklist: category('blacklist', raw, collector) ?? null
    }
  };
};

export interface ValidatedConfig {
  config: Config;
  sources: Record<string, ConfigSource>;
}

/**
 * Validate a merged config object.
 *
 * `origins` maps dotted paths to the layer that supplied them; anything not
 * listed is either a default or came from the file.
 */
export const validate = (
  raw: unknown,
  origins: ReadonlyMap<string, ConfigSource> = new Map(),
  env: NodeJS.ProcessEnv = process.env
): ValidatedConfig => {
  if (!isRecord(raw)) {
    throw new ConfigError([{ key: 'config', detail: 'must be a JSON object', source: 'unknown' }]);
  }

  const collector = new Collector(origins, env);
  const scalars = validateScalars(raw, collector);
  const storage = validateStorage(raw, collector);
  const keyGenerator = validateKeyGenerator(raw, collector);
  const logging = validateLogging(raw, collector);
  const documents = validateDocuments(raw, collector);
  const rateLimits = validateRateLimits(raw, collector);

  if (collector.issues.length > 0) throw new ConfigError(collector.issues);

  const config = {
    // Unknown top-level keys are preserved: forward compatibility for a newer
    // file read by an older binary.
    ...raw,
    ...scalars,
    storage,
    keyGenerator,
    logging,
    documents,
    ...(rateLimits ? { rateLimits } : {})
  } satisfies Config;

  return { config, sources: collector.sources };
};

export const validateConfig = (raw: unknown): Config => validate(raw).config;

export { CONFIG_FIELDS, DEFAULTS, withDefault };
