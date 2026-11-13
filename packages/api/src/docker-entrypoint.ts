// Translate the container environment into a config file.
//
// The Docker image runs this once at boot to produce `./config.js` from the
// `STORAGE_*` / `LOGGING_*` / `KEYGENERATOR_*` / `RATELIMITS_*` / `DOCUMENTS`
// variables the image documents. It writes only what the environment actually
// sets: the server's own defaults fill the rest, and an empty value is treated
// as unset so an unpopulated `ENV` line in the Dockerfile cannot pin a field.
//
// Everything it can express is also expressible with the canonical `HASTE_*`
// names read directly by the server, so this file exists only for backwards
// compatibility with the image's documented variables.
const writeOnly = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

const number = (value: string | undefined): number | undefined => {
  if (!writeOnly(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const list = (value: string | undefined): string[] | undefined => {
  if (!writeOnly(value)) return undefined;
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : undefined;
};

const documents = (value: string | undefined): Record<string, string> | undefined => {
  if (!writeOnly(value)) return undefined;

  const out: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    out[pair.slice(0, index).replace(/\s/g, '')] = pair.slice(index + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
};

const set = (target: Record<string, unknown>, path: string, value: unknown): void => {
  if (value === undefined) return;

  const parts = path.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
};

const env = process.env;

const config: Record<string, unknown> = {};

set(config, 'host', writeOnly(env['HOST']) ? env['HOST'] : undefined);
set(config, 'port', number(env['PORT']));
set(config, 'keyLength', number(env['KEY_LENGTH']));
set(config, 'maxLength', number(env['MAX_LENGTH']));
set(config, 'staticMaxAge', number(env['STATIC_MAX_AGE']));

set(
  config,
  'logging',
  writeOnly(env['LOGGING_LEVEL']) ? [{ level: env['LOGGING_LEVEL'] }] : undefined
);

set(
  config,
  'keyGenerator.type',
  writeOnly(env['KEYGENERATOR_TYPE']) ? env['KEYGENERATOR_TYPE'] : undefined
);
set(
  config,
  'keyGenerator.keyspace',
  writeOnly(env['KEYGENERATOR_KEYSPACE']) ? env['KEYGENERATOR_KEYSPACE'] : undefined
);

set(config, 'storage.type', writeOnly(env['STORAGE_TYPE']) ? env['STORAGE_TYPE'] : undefined);
set(config, 'storage.host', writeOnly(env['STORAGE_HOST']) ? env['STORAGE_HOST'] : undefined);
set(config, 'storage.port', number(env['STORAGE_PORT']));
set(config, 'storage.expire', number(env['STORAGE_EXPIRE_SECONDS']));
set(config, 'storage.db', writeOnly(env['STORAGE_DB']) ? env['STORAGE_DB'] : undefined);
set(
  config,
  'storage.bucket',
  writeOnly(env['STORAGE_AWS_BUCKET']) ? env['STORAGE_AWS_BUCKET'] : undefined
);
set(
  config,
  'storage.region',
  writeOnly(env['STORAGE_AWS_REGION']) ? env['STORAGE_AWS_REGION'] : undefined
);
set(
  config,
  'storage.user',
  writeOnly(env['STORAGE_USERNAME']) ? env['STORAGE_USERNAME'] : undefined
);
set(
  config,
  'storage.password',
  writeOnly(env['STORAGE_PASSWORD']) ? env['STORAGE_PASSWORD'] : undefined
);
set(
  config,
  'storage.path',
  writeOnly(env['STORAGE_FILEPATH']) ? env['STORAGE_FILEPATH'] : undefined
);

const whitelist = list(env['RATELIMITS_WHITELIST']);
const blacklist = list(env['RATELIMITS_BLACKLIST']);
const normalTotal = number(env['RATELIMITS_NORMAL_TOTAL_REQUESTS']);
const normalEvery = number(env['RATELIMITS_NORMAL_EVERY_MILLISECONDS']);
const whitelistTotal = number(env['RATELIMITS_WHITELIST_TOTAL_REQUESTS']);
const whitelistEvery = number(env['RATELIMITS_WHITELIST_EVERY_MILLISECONDS']);
const blacklistTotal = number(env['RATELIMITS_BLACKLIST_TOTAL_REQUESTS']);
const blacklistEvery = number(env['RATELIMITS_BLACKLIST_EVERY_MILLISECONDS']);

if (whitelist || blacklist || normalTotal || normalEvery) {
  set(config, 'rateLimits', {
    ...(whitelist ? { whitelist } : {}),
    ...(blacklist ? { blacklist } : {}),
    categories: {
      ...(normalTotal || normalEvery
        ? {
            normal: {
              ...(normalTotal ? { totalRequests: normalTotal } : {}),
              ...(normalEvery ? { every: normalEvery } : {})
            }
          }
        : {}),
      ...(whitelistTotal || whitelistEvery
        ? {
            whitelist: {
              ...(whitelistTotal ? { totalRequests: whitelistTotal } : {}),
              ...(whitelistEvery ? { every: whitelistEvery } : {})
            }
          }
        : {}),
      ...(blacklistTotal || blacklistEvery
        ? {
            blacklist: {
              ...(blacklistTotal ? { totalRequests: blacklistTotal } : {}),
              ...(blacklistEvery ? { every: blacklistEvery } : {})
            }
          }
        : {})
    }
  });
}

set(config, 'documents', documents(env['DOCUMENTS']));

// Written to stdout by `docker-entrypoint.sh`: `> ./config.js`. The write is
// the process's whole purpose, which is why `no-console` is disabled here.
console.log(JSON.stringify(config, null, 2));
