import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Extract the TrueType face the OG card renders text with.
//
// `satori` lays text out through its own font parser, which reads TrueType
// outlines. JetBrains Mono (the obvious monospace choice) ships `woff2` only on
// npm, which that parser cannot read; `dejavu-fonts-ttf` ships the `.ttf` the
// renderer needs, under a licence that permits redistribution. Keeping the file
// in the repository means the image build, the serverless bundle and a local
// `pnpm start` all render the same card without a network fetch at runtime.
//
// Usage:
//   node scripts/build-font.js           # fetch the pinned version, write static/fonts/
//   node scripts/build-font.js --check   # fail if the file is stale or missing

const VERSION = '2.37.3';
const PACKAGE = 'dejavu-fonts-ttf';
const MEMBER = 'package/ttf/DejaVuSansMono.ttf';

const OUTPUT = path.join(process.cwd(), 'static', 'fonts', 'DejaVuSansMono.ttf');

const packageDir = () => {
  const cache = path.join(os.tmpdir(), `haste-font-${VERSION}`);

  if (fs.existsSync(path.join(cache, MEMBER))) return cache;

  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });

  const tarball = execFileSync(
    'npm',
    ['pack', `${PACKAGE}@${VERSION}`, '--silent', '--pack-destination', cache],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();

  execFileSync('tar', ['-xzf', path.join(cache, tarball), '-C', cache]);
  return cache;
};

const expected = fs.readFileSync(path.join(packageDir(), MEMBER));

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT) : Buffer.alloc(0);

  if (!actual.equals(expected)) {
    process.stderr.write(
      'check:font: static/fonts/DejaVuSansMono.ttf is stale or missing; run `pnpm run gen:font`\n'
    );
    process.exit(1);
  }

  process.stdout.write(`check:font: DejaVu Sans Mono ${VERSION} is current\n`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, expected);
process.stdout.write(
  `gen:font: wrote static/fonts/DejaVuSansMono.ttf (${VERSION}, ${expected.length} bytes)\n`
);
