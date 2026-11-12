import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Build-time precompression.
//
// `serveStatic({ precompressed: true })` looks for `<file>.gz` next to the file
// and serves it with `Content-Encoding: gzip` when the client accepts gzip.
// Writing those siblings at build time removes the per-request compression from
// the hot path entirely.
//
// PNG/ICO are skipped: they are already compressed, so a gzip copy is larger
// than the original and the middleware would still have to fall back.

const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, 'static');
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.map']);

// Explicit recursion: `readdirSync({ recursive: true })` with `Dirent.parentPath`
// needs Node 20.12, and this script runs on whatever Node the build stage has.
const collect = (dir) => {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) out.push(...collect(absolute));
    else if (entry.isFile()) out.push(absolute);
  }

  return out;
};

const files = collect(STATIC_DIR);

let written = 0;
let removed = 0;

for (const file of files) {
  if (file.endsWith('.gz')) continue;

  const target = `${file}.gz`;
  const exists = fs.existsSync(target);

  if (!COMPRESSIBLE.has(path.extname(file))) {
    if (exists) {
      fs.rmSync(target);
      removed++;
    }
    continue;
  }

  const source = fs.readFileSync(file);
  const gzipped = zlib.gzipSync(source, { level: 9 });

  if (gzipped.length < source.length) {
    fs.writeFileSync(target, gzipped);
    written++;
  } else if (exists) {
    fs.rmSync(target);
    removed++;
  }
}

process.stdout.write(`precompress: wrote ${written}, removed ${removed}\n`);
