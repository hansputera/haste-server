import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { NO_SOPS_ENV, SOPS_ENV } from './schema.js';

// The file layer: plain JSON, or a SOPS-encrypted document of any format SOPS
// understands. SOPS is asked for JSON, so YAML-encrypted secrets need no YAML
// parser in this dependency tree.

export class ConfigFileError extends Error {
  readonly key = 'config';
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`invalid config: config: ${message}`);
    this.name = 'ConfigFileError';
    this.configPath = configPath;
  }
}

export interface FileLayer {
  value: unknown;
  decrypted: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A SOPS payload carries a top-level `sops` metadata block. */
const looksEncrypted = (value: unknown): boolean => isRecord(value) && 'sops' in value;

const isTruthy = (value: string | undefined): boolean =>
  value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());

const needsDecryption = (file: string, parsed: unknown, env: NodeJS.ProcessEnv): boolean => {
  if (isTruthy(env[NO_SOPS_ENV])) return false;
  if (isTruthy(env[SOPS_ENV])) return true;
  if (looksEncrypted(parsed)) return true;
  // SOPS-encrypted YAML does not parse as JSON, and the name says what it is.
  return /\.(ya?ml)$/i.test(file) || /\.sops\./.test(path.basename(file));
};

/**
 * Decrypt with the `sops` binary.
 *
 * The binary is the only supported decryptor: it owns key discovery (age, PGP,
 * KMS, Vault), so this process never needs credentials for the encryption keys
 * themselves. A missing binary is a configuration error with a fix in the
 * message, not a stack trace.
 */
export const decryptWithSops = (file: string, env: NodeJS.ProcessEnv = process.env): unknown => {
  let stdout: string;

  try {
    stdout = execFileSync(
      'sops',
      ['--decrypt', '--output-type', 'json', '--input-type', 'json', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }
    );
  } catch (error) {
    const failure = error as { code?: string | number; stderr?: string | Buffer };
    const detail = String(failure.stderr ?? '').trim();

    if (failure.code === 'ENOENT') {
      throw new ConfigFileError(
        file,
        'SOPS-encrypted config requires the `sops` binary on PATH (https://getsops.io)'
      );
    }

    throw new ConfigFileError(file, `SOPS decryption failed: ${detail || String(error)}`);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new ConfigFileError(file, `SOPS returned invalid JSON: ${String(error)}`);
  }
};

/**
 * Read the config file. YAML (encrypted or not) is rejected unless SOPS
 * decrypts it, because plain YAML would need a parser dependency for a file
 * format the deployment never edits by hand.
 */
export const readConfigFile = (file: string, env: NodeJS.ProcessEnv = process.env): FileLayer => {
  let text: string;

  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ConfigFileError(file, `cannot read ${file}: file does not exist`);
    }
    throw new ConfigFileError(file, `cannot read ${file}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  let parseError: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parseError = error;
  }

  if (needsDecryption(file, parsed, env)) {
    const decrypted = decryptWithSops(file, env);
    if (looksEncrypted(decrypted)) {
      throw new ConfigFileError(
        file,
        'SOPS output still carries a `sops` block; refusing to use it'
      );
    }
    return { value: decrypted, decrypted: true };
  }

  if (parseError) {
    // A JavaScript module read where JSON was expected is almost always a
    // shadowed path: a compiled module named like the config file sits next to
    // it, and the resolver picked the module. Say so rather than echoing a
    // syntax error that points at the wrong file.
    const looksLikeModule = /^\s*(import|export)\s/m.test(text) || /^\s*\/\//.test(text);
    const detail = looksLikeModule
      ? `${file} is a JavaScript module, not JSON. A compiled module is shadowing the configuration file; check that no build output shares its name.`
      : `${file} is not valid JSON: ${(parseError as Error).message}`;

    throw new ConfigFileError(file, detail);
  }

  if (looksEncrypted(parsed)) {
    throw new ConfigFileError(
      file,
      `file is SOPS-encrypted but decryption was disabled by ${NO_SOPS_ENV}`
    );
  }

  return { value: parsed, decrypted: false };
};
