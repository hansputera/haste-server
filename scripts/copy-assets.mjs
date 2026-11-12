import fs from 'node:fs';
import path from 'node:path';

// Copy the artefacts `dist/` imports but does not own.
//
// `src/http.ts` reads `../openapi.json`, which resolves to the repository root.
// A packaged install ships `dist` and `static` only, so the file has to exist
// next to `dist` there too.

const ROOT = process.cwd();

fs.copyFileSync(path.join(ROOT, 'openapi.json'), path.join(ROOT, 'dist', 'openapi.json'));
process.stdout.write('copy-assets: openapi.json -> dist/\n');
