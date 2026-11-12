# Security Policy

## Supported versions

The latest minor release receives security fixes. Older minors do not.

## Reporting a vulnerability

Email **security@example.com**, or use GitHub's private vulnerability reporting
on this repository. Do not open a public issue.

Include the version, what you sent, and what happened. A proof of concept helps
but is not required.

We aim to acknowledge within **7 days** and to ship a fix or a mitigation plan
within 30 days for anything rated high or critical.

> The address above is a placeholder. Replace it with a monitored address before
> the first public release; see `docs/adr/0004-serverless-storage.md`.

## Deployment notes

- **The `file` store is unsupported on serverless hosting.** Its writes land on a
  read-only or ephemeral filesystem, so pastes are silently lost. The server
  refuses to boot with `STORAGE_TYPE=file` when `VERCEL` or `NETLIFY` is set.
  Configure `redis`, `postgres`, `mongo`, `memcached`, `amazon-s3`,
  `google-datastore` or `rethinkdb` instead.
- Rate limiting keys on the peer address (`request.ip`, collapsed to an IPv6 /56
  by `express-rate-limit`). Behind a proxy, make sure the proxy is the one
  enforcing client-address limits you rely on.
- Pastes are public to anyone who knows the key. There is no authentication and
  no per-document access control by design.
- `POST /documents` accepts up to 100 MiB per request as a hard ceiling, and
  `maxLength` (default 400000) as the document limit. Lower both if the deployment
  is internet-facing.
