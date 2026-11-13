# Haste

> **This is a fork, not upstream Haste.** It is a modified copy of
> [seejohnrun/haste-server](https://github.com/seejohnrun/haste-server), the
> original Haste server written by John Crepezzi. The public hosted service at
> [hastebin.com](https://hastebin.com) and the `hastebin` project are now owned
> and operated by [Toptal](https://www.toptal.com); this repository is not
> affiliated with, endorsed by, or maintained by Toptal. The changes here —
> TypeScript, Hono, dual Node/Bun runtime, layered configuration — are local to
> this fork and are not part of upstream Haste. The MIT licence and the original
> copyright are unchanged; see [License](#license).

Haste is an open-source pastebin software written in node.js, which is easily
installable in any network. It can be backed by either redis or filesystem,
and has a very easy adapter interface for other stores. A publicly available
version can be found at [hastebin.com](http://hastebin.com)

Major design objectives:

- Be really pretty
- Be really simple
- Be easy to set up and use

Haste works really well with a little utility called
[haste-client](https://github.com/seejohnrun/haste-client), allowing you
to do things like:

`cat something | haste`

which will output a URL to share containing the contents of `cat something`'s
STDOUT. Check the README there for more details and usages.

## Tested Browsers

Any current browser: the client is plain DOM and `fetch`, with no framework.

## Requirements

Node.js **22 or newer** (24 and 26 LTS are tested), **or** Bun 1.4 or newer. Node runs the compiled output in
`packages/api/dist/`; Bun runs the TypeScript sources directly. The package is ESM
(`"type": "module"`).

## Installation

1.  Download the package, and expand it
2.  Explore the settings inside of config.js, but the defaults should be good
3.  `pnpm add`
4.  `pnpm run build`
5.  `pnpm start` (you may specify an optional `<config-path>` as well)

`prestart` rebuilds, so a plain `pnpm start` after an edit still serves the new
code; the explicit `pnpm run build` in the list above is what produces `packages/api/dist/` on
a fresh checkout. `pnpm run serve` runs `packages/api/dist/server.js` with no build step and no
dev dependencies — that is what a production image or a PaaS `Procfile` uses.

## Development

| command                            | what it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `pnpm run dev`                     | `node --watch` on the TypeScript sources               |
| `pnpm run dev:bun`                 | `bun --watch` on the TypeScript sources                |
| `pnpm run check`                   | `tsc --noEmit` (strict)                                |
| `pnpm run lint`                    | eslint, flat config, type-aware                        |
| `pnpm run format` / `format:check` | prettier                                               |
| `pnpm test`                        | build, then `node --test` against `packages/api/dist/` |
| `pnpm run check:openapi`           | validates `openapi.json`                               |

## Operations

- `GET /healthz` — liveness. Answers `{"status":"ok"}` and never touches the
  store, so a store outage does not restart the process.
- `GET /readyz` — readiness. `200 {"status":"ready"}` once the static documents
  are seeded, `503 {"status":"unavailable"}` before that and during shutdown.
- `GET /openapi.json` — the OpenAPI 3.1 description of the API.
- `SIGTERM`/`SIGINT` drain in-flight requests for up to 10 seconds, then exit 0
  (or 1 if the drain times out). A second signal exits immediately.
- Logs are one JSON object per line on stdout, including `requestId`, `method`,
  `path`, `status` and `ms` for every request. An inbound `X-Request-Id` is
  propagated and echoed.

## Settings

Every setting, its type, its default, and every environment variable that
supplies it is listed in **[docs/configuration.md](docs/configuration.md)**,
generated from the field table the server validates against. A short tour:

- `host` / `port` — where the listener binds (default `0.0.0.0:7777`)
- `keyLength` / `maxLength` — key size and largest accepted paste
- `staticMaxAge` — `max-age` for cacheable static assets
- `documents` — seeded documents (`name=path`); these never expire
- `storage`, `logging`, `keyGenerator`, `rateLimits` — see below

## Configuration

Precedence, lowest to highest:

1. built-in defaults
2. a config file — `HASTE_CONFIG`, the `--config` argument, or `./config.js`
3. the environment

Every setting has a canonical environment variable derived from its path:
`HASTE_HOST`, `HASTE_STORAGE__TYPE`, `HASTE_RATE_LIMITS__CATEGORIES__NORMAL__EVERY`.
The historical `PORT`/`STORAGE_TYPE`-style names still work, below the canonical
ones. `HASTE_CONFIG=` (empty) skips the file layer entirely, for deployments that
inject every value.

A bad setting fails the boot with every problem at once, naming the layer that
supplied it:

```
invalid config: port: must be >= 1 (got 0)
invalid config: storage.type: must be one of file, redis, … (got s3)
```

The resolved config is logged once at boot with secrets masked and per-key
provenance (`default`/`file`/`env`/`secret-file`).

### Secrets: mounted files, not environment variables

`<NAME>_FILE` is the Docker/Kubernetes convention: point it at a mounted secret
and the value never enters the process environment.

```sh
docker run \
  -e HASTE_CONFIG=/etc/haste/config.json \
  -e HASTE_STORAGE__PASSWORD_FILE=/run/secrets/storage_password \
  -v ./config.json:/etc/haste/config.json:ro \
  -v ./storage_password:/run/secrets/storage_password:ro \
  haste-server
```

In Kubernetes, mount the ConfigMap as the config file and the Secret as files:

```yaml
env:
  - name: HASTE_CONFIG
    value: /etc/haste/config.json
  - name: HASTE_STORAGE__PASSWORD_FILE
    value: /run/secrets/storage_password
volumeMounts:
  - { name: config, mountPath: /etc/haste }
  - { name: storage-secret, mountPath: /run/secrets, readOnly: true }
volumes:
  - name: config
    configMap: { name: haste-config }
  - name: storage-secret
    secret: { secretName: haste-storage }
```

### Secrets: SOPS

A config file encrypted with [SOPS](https://getsops.io) is decrypted at boot. It
is detected by a top-level `sops` block, by a `.sops.`/`.yaml`/`.yml` name, or
forced with `HASTE_CONFIG_SOPS=1`. Decryption shells out to `sops`, so key
material (age, PGP, KMS, Vault) stays owned by SOPS and never reaches the
process.

```sh
sops --encrypt --age "$HASTE_AGE_RECIPIENT" config.json > config.sops.json
HASTE_CONFIG=config.sops.json node dist/server.js
```

`HASTE_CONFIG_NO_SOPS=1` disables detection, and an encrypted file is then
refused rather than read as plaintext.

```sh
pnpm run check:config-docs   # fails when docs/configuration.md drifted from the code
```

## Rate Limiting

Rate limiting is configured under `rateLimits.categories`. The
`categories.normal` block is the default limit; `categories.whitelist` and
`categories.blacklist` are applied to the addresses listed in `whitelist` and
`blacklist`. Each category takes `totalRequests` and `every` (in milliseconds).
A whitelisted client with no whitelist category is not limited. Exceeding a
limit answers `429` with `{"message":"Rate limit exceeded."}` and a `Retry-After`
header.

## Key Generation

### Phonetic

Attempts to generate phonetic keys, similar to `pwgen`

```json
{
  "type": "phonetic"
}
```

### Random

Generates a random key

```json
{
  "type": "random",
  "keyspace": "abcdef"
}
```

The _optional_ keySpace argument is a string of acceptable characters
for the key.

## Storage

### File

To use file storage (the default) change the storage section in `config.js` to
something like:

```json
{
  "path": "./data",
  "type": "file"
}
```

where `path` represents where you want the files stored.

File storage currently does not support paste expiration, you can follow [#191](https://github.com/seejohnrun/haste-server/issues/191) for status updates.

### Redis

To use redis storage you must install the `redis` package, and have
`redis-server` running on the machine. The store imports it lazily, so it is
only needed by deployments that select this type.

`pnpm add redis`

Once you've done that, your config section should look like:

```json
{
  "type": "redis",
  "host": "localhost",
  "port": 6379,
  "db": 2
}
```

You can also set an `expire` option to the number of seconds to expire keys in.
This is off by default, but will constantly kick back expirations on each view
or post.

All of which are optional except `type` with very logical default values.

If your Redis server is configured for password authentification, use the `password` field.

### Postgres

To use postgres storage you must install the `pg` package

`pnpm add pg`

Once you've done that, your config section should look like:

```json
{
  "type": "postgres",
  "connectionUrl": "postgres://user:password@host:5432/database"
}
```

You can also just set the environment variable for `DATABASE_URL` to your database connection url.

You will have to manually add a table to your postgres database:

`create table entries (id serial primary key, key varchar(255) not null, value text not null, expiration int, unique(key));`

You can also set an `expire` option to the number of seconds to expire keys in.
This is off by default, but will constantly kick back expirations on each view
or post.

All of which are optional except `type` with very logical default values.

### MongoDB

To use mongodb storage you must install the 'mongodb' package

`pnpm add mongodb`

Once you've done that, your config section should look like:

```json
{
  "type": "mongo",
  "connectionUrl": "mongodb://localhost:27017/database"
}
```

You can also just set the environment variable for `DATABASE_URL` to your database connection url.

Unlike with postgres you do NOT have to create the table in your mongo database prior to running.

You can also set an `expire` option to the number of seconds to expire keys in.
This is off by default, but will constantly kick back expirations on each view or post.

### Memcached

To use memcache storage you must install the `memcached` package

`pnpm add memcached`

Once you've done that, your config section should look like:

```json
{
  "type": "memcached",
  "host": "127.0.0.1",
  "port": 11211
}
```

You can also set an `expire` option to the number of seconds to expire keys in.
This behaves just like the redis expirations, but does not push expirations
forward on GETs.

All of which are optional except `type` with very logical default values.

### RethinkDB

To use the RethinkDB storage system, install the official `rethinkdb` driver:

`pnpm add rethinkdb`

The previous `rethinkdbdash` client has had no release since 2022 and is no
longer used.

Once you've done that, your config section should look like this:

```json
{
  "type": "rethinkdb",
  "host": "127.0.0.1",
  "port": 28015,
  "db": "haste"
}
```

In order for this to work, the database must be pre-created before the script is ran.
Also, you must create an `uploads` table, which will store all the data for uploads.

You can optionally add the `user` and `password` properties to use a user system.

### Google Datastore

To use the Google Datastore storage system, you must install the `@google-cloud/datastore` package

`pnpm add @google-cloud/datastore`

Once you've done that, your config section should look like this:

```json
{
  "type": "google-datastore"
}
```

Authentication is handled automatically by [Google Cloud service account credentials](https://cloud.google.com/docs/authentication/getting-started), by providing authentication details to the GOOGLE_APPLICATION_CREDENTIALS environmental variable.

### Amazon S3

To use [Amazon S3](https://aws.amazon.com/s3/) as a storage system, you must
install the AWS SDK for JavaScript v3:

`pnpm add @aws-sdk/client-s3`

The v2 `aws-sdk` package reached end-of-support and is no longer used.

Once you've done that, your config section should look like this:

```json
{
  "type": "amazon-s3",
  "bucket": "your-bucket-name",
  "region": "us-east-1"
}
```

Authentication is handled automatically by the client. Check
[Amazon's documentation](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html)
for more information. You will need to grant your role these permissions to
your bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Effect": "Allow",
      "Resource": "arn:aws:s3:::your-bucket-name-goes-here/*"
    }
  ]
}
```

## Deployment

The app is built once by `createApp()` in `packages/api/src/http.ts` and never listens itself;
`packages/api/src/runtime.ts` attaches a listener for Node or Bun. The same application object
therefore runs as a long-lived process or as a function.

### Any server (VPS, container, PaaS with a Node runtime)

```bash
pnpm install --frozen-lockfile
pnpm run build
PORT=8080 HOST=0.0.0.0 pnpm run serve
```

Or point the platform at `packages/api/dist/server.js` directly. Set `PORT`; most hosts inject
it. On Bun, `bun packages/api/src/server.ts` runs the sources with no build step, and
`bun packages/api/dist/server.js` runs the compiled output.

### Docker

`Dockerfile` is a two-stage build on `node:24-alpine`. The first stage installs
dev dependencies and compiles the workspace; the second copies only
`packages/api/dist/`, `packages/api/static/`, the package metadata and the
optional store clients, and runs as the unprivileged `node` user.
`docker-entrypoint.sh` translates the `STORAGE_*` environment variables into a
`config.js` through `packages/api/dist/docker-entrypoint.js`.

```bash
docker build -t haste-server .
docker run -p 7777:7777 -e STORAGE_TYPE=file -e STORAGE_FILEPATH=/tmp/data haste-server
```

The image refuses `STORAGE_TYPE=file` on a read-only working directory: the file
store writes to `./data`, so mount a volume owned by uid 1000 or point
`STORAGE_FILEPATH` at a writable path.

### Vercel

Vercel's project **Root Directory** must be `packages/api`: that is where
`vercel.json` and `api/index.ts` live. The config routes every request to
`api/index.ts`, which delegates to `@hono/vercel`'s Node handler, imports
`dist/http.js` and ships `static/`, `openapi.json`, `about.md` and the resvg wasm
binary through `includeFiles`. The build command is `pnpm run build`, which
builds the workspace from its root. `.nvmrc` pins Node 24, because Vercel's
default (20) is below the package's floor.

Set `HASTE_CONFIG=` (empty) so configuration comes from the environment only,
and pick a store: `file` works but is **not durable** — it needs
`HASTE_STORAGE__PATH=/tmp/…` and loses pastes when the instance is recycled. Use
`postgres` (the only store whose client is already a dependency) for anything
that must persist. Full walkthrough, including the Postgres schema:
[`docs/deployment.md`](docs/deployment.md).

### Netlify

`netlify.toml` redirects every request to `netlify/functions/server.ts`, which
delegates to `@hono/netlify`'s Web `Request`/`Response` handler. The build command
is `pnpm run build` for the same reason. The `file` store works there but is not
durable; see [`docs/deployment.md`](docs/deployment.md).

### Serverless storage

A serverless filesystem lives only inside an invocation, so `file` there means
a disposable pastebin. Use `redis`, `postgres`, `mongo`, `memcached`,
`amazon-s3`, `google-datastore` or `rethinkdb` when pastes must persist.
For Postgres, point `DATABASE_URL` at your
provider's pooled endpoint (for example with `?pgbouncer=true`) since each
invocation may open a connection. The pool is created lazily, so an unset or
invalid URL only fails on the first query.

### Which store

`file` works on a server that owns its disk and nowhere else. Store clients are
imported lazily: selecting `redis` requires the `redis` package installed, and
so on. The Docker image installs all of them; a bare `pnpm add` installs only
the declared dependencies (`hono`, `@hono/node-server`, `@hono/vercel`,
`@hono/netlify`, `busboy`, `express-rate-limit`, `pino`, `pg`), so add your client:

```bash
pnpm add redis        # or memcached, mongodb, @aws-sdk/client-s3, @google-cloud/datastore, rethinkdb
```

## Docker

### Build image

```bash
docker build --tag haste-server .
```

### Run container

For this example we will run haste-server, and connect it to a redis server

```bash
docker run --name haste-server-container --env STORAGE_TYPE=redis --env STORAGE_HOST=redis-server --env STORAGE_PORT=6379 haste-server
```

### Use docker-compose example

There is an example `docker-compose.yml` which runs haste-server together with memcached

```bash
docker-compose up
```

### Configuration

The docker image is configured using environmental variables as you can see in the example above.

Here is a list of all the environment variables

### Storage

|          Name          | Default value |                                                  Description                                                  |
| :--------------------: | :-----------: | :-----------------------------------------------------------------------------------------------------------: |
|      STORAGE_TYPE      |   memcached   |    Type of storage . Accepted values: "memcached","redis","postgres","rethinkdb", "amazon-s3", and "file"     |
|      STORAGE_HOST      |   127.0.0.1   |                 Storage host. Applicable for types: memcached, redis, postgres, and rethinkdb                 |
|      STORAGE_PORT      |     11211     |           Port on the storage host. Applicable for types: memcached, redis, postgres, and rethinkdb           |
| STORAGE_EXPIRE_SECONDS |    2592000    | Number of seconds to expire keys in. Applicable for types. Redis, postgres, memcached. `expire` option to the |
|       STORAGE_DB       |       2       |                    The name of the database. Applicable for redis, postgres, and rethinkdb                    |
|    STORAGE_PASSWORD    |               |                       Password for database. Applicable for redis, postges, rethinkdb .                       |
|    STORAGE_USERNAME    |               |                           Database username. Applicable for postgres, and rethinkdb                           |
|   STORAGE_AWS_BUCKET   |               |                          Applicable for amazon-s3. This is the name of the S3 bucket                          |
|   STORAGE_AWS_REGION   |               |                      Applicable for amazon-s3. The region in which the bucket is located                      |
|    STORAGE_FILEPATH    |               |                            Path to file to save data to. Applicable for type file                             |

### Logging

|       Name        | Default value | Description |
| :---------------: | :-----------: | :---------: |
|   LOGGING_LEVEL   |    verbose    |             |
|   LOGGING_TYPE=   |    Console    |
| LOGGING_COLORIZE= |     true      |

### Basics

|           Name           |  Default value   |                                        Description                                        |
| :----------------------: | :--------------: | :---------------------------------------------------------------------------------------: |
|           HOST           |     0.0.0.0      |                         The hostname which the server answers on                          |
|           PORT           |       7777       |                          The port on which the server is running                          |
|        KEY_LENGTH        |        10        |                              the length of the keys to user                               |
|        MAX_LENGTH        |      400000      |                                 maximum length of a paste                                 |
|      STATIC_MAX_AGE      |      86400       |                                 max age for static assets                                 |
| RECOMPRESS_STATIC_ASSETS |       true       |                        whether or not to compile static js assets                         |
|    KEYGENERATOR_TYPE     |     phonetic     |             Type of key generator. Acceptable values: "phonetic", or "random"             |
|  KEYGENERATOR_KEYSPACE   |                  |                  keySpace argument is a string of acceptable characters                   |
|        DOCUMENTS         | about=./about.md | Comma separated list of static documents to serve. ex: \n about=./about.md,home=./home.md |

### Rate limits

|                 Name                 |             Default value             |                                       Description                                        |
| :----------------------------------: | :-----------------------------------: | :--------------------------------------------------------------------------------------: |
|   RATELIMITS_NORMAL_TOTAL_REQUESTS   |                  500                  | By default anyone uncategorized will be subject to 500 requests in the defined timespan. |
| RATELIMITS_NORMAL_EVERY_MILLISECONDS |                 60000                 |             The timespan to allow the total requests for uncategorized users             |
| RATELIMITS_WHITELIST_TOTAL_REQUESTS  |                                       |      By default client names in the whitelist will not have their requests limited.      |
|  RATELIMITS_WHITELIST_EVERY_SECONDS  |                                       |      By default client names in the whitelist will not have their requests limited.      |
|         RATELIMITS_WHITELIST         | example1.whitelist,example2.whitelist |           Comma separated list of the clients which are in the whitelist pool            |
| RATELIMITS_BLACKLIST_TOTAL_REQUESTS  |                                       |    By default client names in the blacklist will be subject to 0 requests per hours.     |
|  RATELIMITS_BLACKLIST_EVERY_SECONDS  |                                       |     By default client names in the blacklist will be subject to 0 requests per hours     |
|         RATELIMITS_BLACKLIST         | example1.blacklist,example2.blacklist |           Comma separated list of the clients which are in the blacklistpool.            |

## Author

Original Haste: John Crepezzi <john.crepezzi@gmail.com>

Upstream project: [seejohnrun/haste-server](https://github.com/seejohnrun/haste-server)

This fork: [hansputera/haste-server](https://github.com/hansputera/haste-server)
(hansputera <hansputera@users.noreply.github.com>)

## License

(The MIT License)

Copyright © 2011-2012 John Crepezzi

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the ‘Software’), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED ‘AS IS’, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE

### Other components:

- highlight.js: Copyright © 2006, Ivan Sagalaev
- highlightjs-coffeescript: WTFPL - Copyright © 2011, Dmytrii Nagirniak
