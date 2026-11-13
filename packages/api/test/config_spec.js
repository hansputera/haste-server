import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  ConfigError,
  describeResolvedConfig,
  resolveConfig,
  resolveConfigPath,
  validateConfig
} from '../dist/settings.js';

// Configuration resolution is the surface an operator touches on every
// deployment, so these tests pin the precedence order, the secret handling and
// the error contract rather than the individual field validators.

const commandExists = (name) => {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasSops = commandExists('sops');
const hasGpg = commandExists('gpg');

describe('config', () => {
  let dir;
  let basePath;
  let secretPath;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haste-config-'));
    basePath = path.join(dir, 'base.json');
    secretPath = path.join(dir, 'password');

    fs.writeFileSync(
      basePath,
      JSON.stringify({
        port: 7777,
        maxLength: 1000,
        storage: { type: 'file', path: './data' },
        logging: [{ level: 'info' }]
      })
    );
    fs.writeFileSync(secretPath, 'from-the-file\n');
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('precedence', () => {
    it('should use the file when the environment is empty', () => {
      const resolved = resolveConfig({ configPath: basePath, env: {} });

      assert.equal(resolved.config.port, 7777);
      assert.equal(resolved.config.maxLength, 1000);
      assert.equal(resolved.sources.port, 'file');
      assert.equal(resolved.decrypted, false);
    });

    it('should let the environment override the file', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_PORT: '8080', HASTE_STORAGE__TYPE: 'redis' }
      });

      assert.equal(resolved.config.port, 8080);
      assert.equal(resolved.config.storage.type, 'redis');
      assert.equal(resolved.sources.port, 'env');
      assert.equal(resolved.sources['storage.type'], 'env');
      // Untouched keys keep the file value and provenance.
      assert.equal(resolved.config.maxLength, 1000);
      assert.equal(resolved.sources.maxLength, 'file');
    });

    it('should prefer the canonical name over a legacy alias', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_PORT: '8100', PORT: '8200' }
      });

      assert.equal(resolved.config.port, 8100);
    });

    it('should honour a legacy alias when the canonical name is absent', () => {
      const resolved = resolveConfig({ configPath: basePath, env: { PORT: '8300' } });

      assert.equal(resolved.config.port, 8300);
      assert.equal(resolved.sources.port, 'env');
    });

    it('should fall back to built-in defaults for keys nothing supplies', () => {
      const resolved = resolveConfig({ configPath: basePath, env: {} });

      assert.equal(resolved.config.keyLength, 10);
      assert.equal(resolved.sources.keyLength, 'default');
    });

    it('should run from the environment alone when the file layer is disabled', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        withoutFile: true,
        env: { HASTE_PORT: '9000', HASTE_STORAGE__TYPE: 'file' }
      });

      assert.equal(resolved.configPath, null);
      assert.equal(resolved.config.port, 9000);
    });
  });

  describe('environment mapping', () => {
    it('should nest on double underscores and split camelCase', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: {
          HASTE_RATE_LIMITS__CATEGORIES__NORMAL__TOTAL_REQUESTS: '42',
          HASTE_RATE_LIMITS__CATEGORIES__NORMAL__EVERY: '30000',
          HASTE_RATE_LIMITS__WHITELIST: '10.0.0.1, 10.0.0.2'
        }
      });

      assert.equal(resolved.config.rateLimits.categories.normal.totalRequests, 42);
      assert.equal(resolved.config.rateLimits.categories.normal.every, 30000);
      assert.deepEqual(resolved.config.rateLimits.whitelist, ['10.0.0.1', '10.0.0.2']);
    });

    it('should parse the documents map from a comma-separated list', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_DOCUMENTS: 'about=./about.md,faq=./faq.md' }
      });

      assert.deepEqual(resolved.config.documents, {
        about: './about.md',
        faq: './faq.md'
      });
    });

    it('should reject a malformed documents entry by name', () => {
      assert.throws(
        () => resolveConfig({ configPath: basePath, env: { HASTE_DOCUMENTS: 'nonsense' } }),
        /invalid config: /
      );
    });

    it('should ignore an empty value instead of pinning a field to it', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_MAX_LENGTH: '', HASTE_PORT: '' }
      });

      assert.equal(resolved.config.maxLength, 1000);
      assert.equal(resolved.config.port, 7777);
    });
  });

  describe('secret files', () => {
    it('should read a <NAME>_FILE secret and prefer it over the plain variable', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: {
          HASTE_STORAGE__PASSWORD: 'inline-secret',
          HASTE_STORAGE__PASSWORD_FILE: secretPath
        }
      });

      assert.equal(resolved.config.storage.password, 'from-the-file');
      assert.equal(resolved.sources['storage.password'], 'secret-file');
    });

    it('should mask secrets and embedded credentials in the log view', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: {
          HASTE_STORAGE__PASSWORD_FILE: secretPath,
          HASTE_STORAGE__CONNECTION_URL: 'postgres://user:hunter2@db:5432/haste'
        }
      });

      const view = describeResolvedConfig(resolved);
      const serialized = JSON.stringify(view);

      assert.equal(view.config.storage.password, '***');
      assert.equal(view.config.storage.connectionUrl, '***');
      assert.ok(!serialized.includes('from-the-file'));
      assert.ok(!serialized.includes('hunter2'));
    });

    it('should mask credentials embedded in a non-secret field', () => {
      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_STORAGE__HOST: 'redis://user:hunter2@cache' }
      });

      const view = describeResolvedConfig(resolved);

      assert.ok(!JSON.stringify(view).includes('hunter2'));
    });

    it('should fail with the variable name when the secret file is missing', () => {
      assert.throws(
        () =>
          resolveConfig({
            configPath: basePath,
            env: { HASTE_STORAGE__PASSWORD_FILE: path.join(dir, 'absent') }
          }),
        /HASTE_STORAGE__PASSWORD_FILE/
      );
    });

    it('should treat an empty secret file as unset', () => {
      const emptyPath = path.join(dir, 'empty');
      fs.writeFileSync(emptyPath, '\n');

      const resolved = resolveConfig({
        configPath: basePath,
        env: { HASTE_STORAGE__PASSWORD_FILE: emptyPath }
      });

      assert.equal(resolved.config.storage.password, undefined);
    });
  });

  describe('errors', () => {
    it('should report every problem at once with its source', () => {
      let error;

      try {
        resolveConfig({
          configPath: basePath,
          env: { HASTE_PORT: '0', HASTE_STORAGE__TYPE: 's3', HASTE_KEY_LENGTH: 'abc' }
        });
      } catch (caught) {
        error = caught;
      }

      assert.ok(error instanceof ConfigError);
      assert.equal(error.issues.length, 3);

      const keys = error.issues.map((issue) => issue.key).sort();
      assert.deepEqual(keys, ['keyLength', 'port', 'storage.type']);

      // The contract the plan and CI greps depend on.
      assert.match(error.message, /^invalid config: port: /);
      assert.match(error.message, /invalid config: keyLength: /);
      assert.match(error.message, /invalid config: storage\.type: /);

      // Every issue carries the variable that supplied the bad value.
      const portIssue = error.issues.find((issue) => issue.key === 'port');
      assert.equal(portIssue.source, 'env');
      assert.equal(portIssue.env, 'HASTE_PORT');
    });

    it('should name the file when the file layer cannot be read', () => {
      assert.throws(
        () => resolveConfig({ configPath: path.join(dir, 'missing.json'), env: {} }),
        /invalid config: config: cannot read .*missing\.json/
      );
    });

    it('should name the file when it is not JSON', () => {
      const brokenPath = path.join(dir, 'broken.json');
      fs.writeFileSync(brokenPath, '{ not json');

      assert.throws(
        () => resolveConfig({ configPath: brokenPath, env: {} }),
        /invalid config: config: .*is not valid JSON/
      );
    });

    it('should keep validateConfig as a single-shot entry point', () => {
      assert.throws(
        () => validateConfig({ storage: { type: 'nope' } }),
        /invalid config: storage\.type/
      );
    });
  });

  describe('config path resolution', () => {
    it('should prefer the argument, then HASTE_CONFIG, then the default', () => {
      assert.equal(
        resolveConfigPath('/argv.json', { env: { HASTE_CONFIG: '/env.json' } }),
        '/argv.json'
      );
      assert.equal(
        resolveConfigPath(undefined, { env: { HASTE_CONFIG: '/env.json' } }),
        '/env.json'
      );
      assert.equal(resolveConfigPath(undefined, { env: {} }), 'config.js');
      assert.equal(resolveConfigPath(undefined, { env: {}, defaultPath: '/x.json' }), '/x.json');
    });

    it('should treat an empty HASTE_CONFIG as "no file layer"', () => {
      assert.equal(resolveConfigPath(undefined, { env: { HASTE_CONFIG: '' } }), null);
    });
  });

  describe('SOPS', { skip: hasSops && hasGpg ? false : 'sops or gpg not installed' }, () => {
    let encryptedPath;
    let gpgHome;

    before(() => {
      // A throwaway GPG key in a private homedir: the test never touches the
      // operator's keyring.
      gpgHome = path.join(dir, 'gnupg');
      fs.mkdirSync(gpgHome, { recursive: true, mode: 0o700 });

      const runGpg = (args) =>
        execFileSync('gpg', args, {
          encoding: 'utf8',
          env: { ...process.env, GNUPGHOME: gpgHome },
          stdio: ['ignore', 'pipe', 'pipe']
        });

      runGpg([
        '--batch',
        '--pinentry-mode',
        'loopback',
        '--passphrase',
        '',
        '--quick-generate-key',
        'haste config test <test@haste.invalid>',
        'default',
        'default',
        'never'
      ]);

      const fingerprint = runGpg(['--list-keys', '--with-colons'])
        .split('\n')
        .find((line) => line.startsWith('fpr:'))
        .split(':')[9];

      encryptedPath = path.join(dir, 'config.sops.json');
      fs.writeFileSync(
        encryptedPath,
        execFileSync(
          'sops',
          [
            '--encrypt',
            '--pgp',
            fingerprint,
            '--input-type',
            'json',
            '--output-type',
            'json',
            basePath
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, GNUPGHOME: gpgHome },
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )
      );
    });

    it('should decrypt the file and use its values', () => {
      const resolved = resolveConfig({
        configPath: encryptedPath,
        env: { ...process.env, GNUPGHOME: gpgHome }
      });

      assert.equal(resolved.decrypted, true);
      assert.equal(resolved.config.maxLength, 1000);
      assert.equal(resolved.sources.maxLength, 'file');
    });

    it('should let the environment override a decrypted value', () => {
      const resolved = resolveConfig({
        configPath: encryptedPath,
        env: { ...process.env, GNUPGHOME: gpgHome, HASTE_PORT: '8123' }
      });

      assert.equal(resolved.config.port, 8123);
      assert.equal(resolved.sources.port, 'env');
    });

    it('should refuse an encrypted file when decryption is disabled', () => {
      assert.throws(
        () =>
          resolveConfig({
            configPath: encryptedPath,
            env: { ...process.env, GNUPGHOME: gpgHome, HASTE_CONFIG_NO_SOPS: '1' }
          }),
        /SOPS-encrypted but decryption was disabled/
      );
    });
  });
});
