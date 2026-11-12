import { execFileSync } from 'node:child_process';

// Check formatting of the files a branch actually touches.
//
// `prettier --check .` would fail on files that predate this configuration,
// which turns the gate into noise. The rule enforced here is the one that
// matters: everything you change is formatted.
//
// The changed set is "committed vs the merge base with main, plus working-tree
// edits and untracked files". Each file is checked on its own so a file prettier
// has no parser for (Dockerfile, Procfile, .toml, .sh) is skipped instead of
// aborting the run.

const run = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const resolveBase = () => {
  for (const candidate of ['origin/main', 'main', 'HEAD']) {
    try {
      return run(['merge-base', 'HEAD', candidate]);
    } catch {
      // try the next candidate
    }
  }
  return null;
};

const base = resolveBase();

if (!base) {
  process.stdout.write('format:check: no git base to compare against, skipping\n');
  process.exit(0);
}

const targets = [
  ...run(['diff', '--name-only', '--diff-filter=ACMR', base, '--', '.']).split('\n'),
  ...run(['ls-files', '--others', '--exclude-standard']).split('\n')
].filter(Boolean);

if (targets.length === 0) {
  process.stdout.write('format:check: nothing changed since the base, nothing to check\n');
  process.exit(0);
}

const unformatted = [];
let checked = 0;

for (const file of targets) {
  try {
    execFileSync('npx', ['--no-install', 'prettier', '--check', file], {
      stdio: 'ignore'
    });
    checked++;
  } catch (error) {
    // prettier exits 1 for "would be reformatted" and 2 for "no parser for this
    // file"; the second is not a formatting problem.
    const status = typeof error.status === 'number' ? error.status : 1;
    if (status === 1) unformatted.push(file);
    if (status !== 2) checked++;
  }
}

if (unformatted.length === 0) {
  process.stdout.write(`format:check: ${checked} changed files are formatted\n`);
  process.exit(0);
}

process.stderr.write(
  `format:check: not formatted:\n${unformatted.map((file) => `  ${file}`).join('\n')}\n` +
    'Run `npm run format` (or `npx prettier --write <file>`) and commit the result.\n'
);
process.exit(1);
