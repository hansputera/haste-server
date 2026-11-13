import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish the built SPA into the API's static tree.
//
// The API serves one static root — `packages/api/static` — and every deploy
// surface already ships it: Vercel's `outputDirectory`, Netlify's
// `included_files`, the Docker image and the VPS installer. Copying the Vite
// build to `static/v2/` keeps that true and puts the SPA behind the same
// `serveStatic` and precompression as v1.
//
// Paths are resolved from this file, not `cwd`: the script runs from
// `packages/web` when invoked directly and from the workspace root through
// `pnpm --filter`.

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/web/scripts
const source = path.resolve(here, '..', 'dist');
const target = path.resolve(here, '..', '..', 'api', 'static', 'v2');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  process.stderr.write(`copy-web: ${source} has no index.html; run vite build first\n`);
  process.exit(1);
}

// Removed first so a renamed chunk leaves nothing behind: the API's static
// index is built from what is on disk at boot.
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

process.stdout.write(`copy-web: ${path.relative(process.cwd(), source)} -> static/v2/\n`);
