import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Extract the TrueType faces the OG card renders text with.
//
// `satori` lays text out through its own font parser, which reads TrueType
// outlines. The card reproduces carbon.now.sh, whose default font is Hack
// 2.020, so Hack is what the card is drawn in. `hack-font` on npm ships the
// `.ttf` for it; JetBrains Mono (the other obvious monospace) ships `woff2`
// only, which that parser cannot read.
//
// DejaVu Sans Mono is kept as the fallback: it has the wider coverage, so a
// paste containing characters Hack lacks still renders instead of dropping
// glyphs.
//
// Usage:
//   node scripts/build-font.js           # fetch the pinned versions, write static/fonts/
//   node scripts/build-font.js --check   # fail if a file is stale or missing

const FACES = [
  {
    // Carbon's own default (`DEFAULT_SETTINGS.fontFamily`), loaded by Carbon
    // from jsDelivr as 2.020; the npm package tracks the same designer release.
    output: path.join('static', 'fonts', 'Hack-Regular.ttf'),
    package: 'hack-font',
    version: '3.3.0',
    member: 'package/build/ttf/Hack-Regular.ttf'
  },
  {
    output: path.join('static', 'fonts', 'DejaVuSansMono.ttf'),
    package: 'dejavu-fonts-ttf',
    version: '2.37.3',
    member: 'package/ttf/DejaVuSansMono.ttf'
  }
];

const packageDir = (face) => {
  const cache = path.join(os.tmpdir(), `haste-font-${face.package}-${face.version}`);

  if (fs.existsSync(path.join(cache, face.member))) return cache;

  fs.rmSync(cache, { recursive: true, force: true });
  fs.mkdirSync(cache, { recursive: true });

  const tarball = execFileSync(
    'npm',
    ['pack', `${face.package}@${face.version}`, '--silent', '--pack-destination', cache],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();

  execFileSync('tar', ['-xzf', path.join(cache, tarball), '-C', cache]);
  return cache;
};

const check = process.argv.includes('--check');
let failed = false;

for (const face of FACES) {
  const expected = fs.readFileSync(path.join(packageDir(face), face.member));
  const output = path.join(process.cwd(), face.output);
  const name = path.basename(face.output);

  if (check) {
    const actual = fs.existsSync(output) ? fs.readFileSync(output) : Buffer.alloc(0);

    if (!actual.equals(expected)) {
      process.stderr.write(`check:font: ${face.output} is stale or missing; run gen:font\n`);
      failed = true;
    } else {
      process.stdout.write(`check:font: ${name} (${face.package} ${face.version}) is current\n`);
    }
    continue;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, expected);
  process.stdout.write(
    `gen:font: wrote ${face.output} (${face.package} ${face.version}, ${expected.length} bytes)\n`
  );
}

if (failed) process.exit(1);
