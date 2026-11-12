import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Run every `*_spec.js` under test/.
//
// `node --test <glob>` is not portable: Node 20's runner does not expand a glob
// argument ("Could not find 'test/**/*_spec.js'"), while Node 22 treats a bare
// directory inconsistently with 20. Enumerating the files here and handing node
// explicit paths is stable across both, and a missing suite is impossible to
// overlook the way it is with a glob that quietly matches nothing.

const testDir = path.join(process.cwd(), 'test');

const collect = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(absolute);
    return entry.isFile() && entry.name.endsWith('_spec.js') ? [absolute] : [];
  });

const files = collect(testDir).sort();

if (files.length === 0) {
  process.stderr.write(`run-tests: no *_spec.js files under ${testDir}\n`);
  process.exit(1);
}

// Printed so a run that silently discovers the wrong set is obvious in CI logs.
process.stdout.write(`run-tests: ${files.length} spec files on ${process.version}\n`);

try {
  execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
