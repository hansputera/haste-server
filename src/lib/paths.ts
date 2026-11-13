// Where the application's own files live at runtime.
//
// `static/`, `openapi.json` and the seeded documents sit next to `dist/`, not
// inside it. Resolving them from `import.meta.url` works for ESM — the Node
// process, Bun, Vercel's handler — but not for a CommonJS bundle: esbuild
// replaces `import.meta.url` with a path to the *bundle*, so `../static`
// would point outside the deployment. Netlify's bundler emits CommonJS.
//
// The rule is therefore: an explicit `HASTE_APP_ROOT` wins, then the directory
// above `dist/` if this module is running from it, then the working directory,
// which is where a function bundle is unpacked (`/var/task`).
//
// Verified for all three shapes: a checkout running `dist/server.js`, a
// `dist`-only install, and a bundled CJS function.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = ['static', 'openapi.json'];

const isAppRoot = (candidate: string): boolean =>
  MARKERS.every((marker) => existsSync(join(candidate, marker)));

const moduleDir = (): string | null => {
  try {
    // Absent in a CJS bundle, where it is replaced by a literal or left as an
    // undefined property. Either way the check below is what matters.
    const specifier = import.meta.url;
    if (typeof specifier !== 'string') return null;
    return resolve(fileURLToPath(new URL('.', specifier)));
  } catch {
    return null;
  }
};

const candidates = (): string[] => {
  const out: string[] = [];
  const configured = process.env.HASTE_APP_ROOT;
  if (configured) out.push(resolve(configured));

  const dir = moduleDir();
  // `dist/http.js` -> `<root>`; a bundled `server.js` -> its own directory,
  // which is not a root, so the probe rejects it.
  if (dir) out.push(resolve(dir, '..'), dir);

  out.push(process.cwd());
  return out;
};

/** The directory holding `static/` and `openapi.json`. */
export const APP_ROOT = candidates().find(isAppRoot) ?? resolve(moduleDir() ?? process.cwd(), '..');

export const STATIC_ROOT = join(APP_ROOT, 'static');
export const OPENAPI_PATH = join(APP_ROOT, 'openapi.json');
