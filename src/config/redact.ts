import type { Config } from '../lib/types.js';

// Masking for anything that leaves the process: logs, the generated
// documentation, and error messages that quote a value.
//
// Two layers, because a secret can arrive either as a leaf (a password) or
// embedded in a connection string. Both are applied, so a URL pasted into a
// `path` field is still redacted.

const SECRET_PATH = /(^|\.)(password|secret|token|apiKey|privateKey|connectionUrl|credentials)$/i;

export const MASK = '***';

/** True when a dotted config path is declared secret in the field table. */
export const isSecretPath = (path: string, declared: ReadonlySet<string>): boolean =>
  declared.has(path) || SECRET_PATH.test(path);

/** Replace credentials embedded in any connection string (`scheme://user:pass@`). */
export const maskSecretsInString = (value: string): string =>
  value.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/)[^:@/\s]+:[^@/\s]+@/gi,
    (_match, scheme: string) => `${scheme}${MASK}:${MASK}@`
  );

const maskLeaves = (value: unknown, path: string, declared: ReadonlySet<string>): unknown => {
  if (typeof value === 'string') {
    const masked = maskSecretsInString(value);
    return isSecretPath(path, declared) ? MASK : masked;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => maskLeaves(entry, `${path}[${index}]`, declared));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        maskLeaves(entry, path ? `${path}.${key}` : key, declared)
      ])
    );
  }

  return value;
};

/**
 * A copy of `config` safe to log. Secret leaves become `***`; every string value
 * has credentials stripped, so a connection string pasted into an unexpected
 * field is still protected.
 */
export const redactConfig = (
  config: Config,
  declaredSecrets: ReadonlySet<string> = new Set()
): Record<string, unknown> => maskLeaves(config, '', declaredSecrets) as Record<string, unknown>;
