import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Rebuild `static/highlight.min.js` from the maintained Highlight.js release.
//
// The previous file was Highlight.js 10.2.1, shipped in 2020 and no longer
// receiving grammar fixes. The v11 distribution ships ESM modules only, while
// the worker loads the bundle as a classic script (`importScripts`), so this
// script assembles a classic build: the core bundle plus the grammars this
// deployment advertises in `haste.extensionMap`.
//
// Usage:
//   node scripts/build-highlight.js           # fetch the pinned version, write static/
//   node scripts/build-highlight.js --check   # fail if the file is stale

const VERSION = '11.12.0';
const PACKAGE = '@highlightjs/cdn-assets';

// Every language name `static/application.js` can ask for. Keeping this
// explicit means a v11 upgrade that drops a grammar fails here, not in a
// user's browser where the worker would silently fall back to auto-detect.
const LANGUAGES = [
  'bash',
  'coffeescript',
  'cpp',
  'css',
  'delphi',
  'diff',
  'erlang',
  'go',
  'haskell',
  'ini',
  'java',
  'javascript',
  'json',
  'latex',
  'lisp',
  'lua',
  'markdown',
  'objectivec',
  'perl',
  'php',
  'python',
  'ruby',
  'scala',
  'smalltalk',
  'sql',
  'swift',
  'typescript',
  'vala',
  'vbscript',
  'xml'
];

const OUTPUT = path.join(process.cwd(), 'static', 'highlight.min.js');

const packageDir = () => {
  const cache = path.join(os.tmpdir(), `haste-highlight-${VERSION}`);

  if (fs.existsSync(path.join(cache, 'es', 'core.min.js'))) return cache;

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

  execFileSync('tar', ['-xzf', path.join(cache, tarball), '-C', cache, '--strip-components=1']);
  return cache;
};

const stripModuleSyntax = (source) => {
  // `es/core.min.js` ends with `export{te as default}`; the language modules end
  // with `export default hljsGrammar`. Everything else is plain script.
  const withoutExports = source
    .replace(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};?/g, '')
    .replace(/export\s+default\s+[A-Za-z_$][\w$]*;?/g, '');

  // Only real module statements matter: grammar regexes contain the words
  // "import" and "export" as language keywords.
  const moduleStatement = /^\s*(?:import|export)\s+[\w${*]/m;
  if (moduleStatement.test(withoutExports)) {
    throw new Error('unexpected module syntax left in the Highlight.js source');
  }

  return withoutExports;
};

const build = () => {
  const dir = packageDir();
  const coreSource = fs.readFileSync(path.join(dir, 'es', 'core.min.js'), 'utf8');

  // v11's core is an ESM module: `const te = HLJS({}); ... export{te as default}`.
  // The default binding is minified, so read it rather than guess it.
  const defaultBinding = coreSource.match(/export\s*\{\s*([\w$]+)\s+as\s+default\s*\}/)?.[1];
  if (!defaultBinding) throw new Error('could not find the Highlight.js core default export');

  const core = stripModuleSyntax(coreSource).trim();

  const parts = [core];

  for (const language of LANGUAGES) {
    const file = path.join(dir, 'es', 'languages', `${language}.min.js`);
    if (!fs.existsSync(file)) {
      throw new Error(`Highlight.js ${VERSION} has no grammar for "${language}"`);
    }

    const grammar = stripModuleSyntax(fs.readFileSync(file, 'utf8')).trim();
    parts.push(
      `${grammar}\n${defaultBinding}.registerLanguage(${JSON.stringify(language)}, hljsGrammar);`
    );
  }

  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  const banner = [
    '/*!',
    `  Highlight.js ${version} (classic build)`,
    '  Assembled by scripts/build-highlight.js from @highlightjs/cdn-assets.',
    '  (c) 2006 Josh Goebel and other contributors. License: BSD-3-Clause',
    `  Grammars: ${LANGUAGES.join(', ')}`,
    '*/'
  ].join('\n');

  // `importScripts` runs a classic script in the worker's global scope, so the
  // assembled instance is published as `hljs` for the worker and for anything
  // else that expects the historical global.
  return `${banner}\nvar hljs=function(){"use strict";\n${parts.join('\n')}\n;return ${defaultBinding};}();\n`;
};

const expected = build();

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';

  if (actual !== expected) {
    process.stderr.write(
      'static/highlight.min.js is stale: run `npm run gen:highlight` and commit the result\n'
    );
    process.exit(1);
  }

  process.stdout.write(`check:highlight: highlight.js ${VERSION} bundle is current\n`);
  process.exit(0);
}

fs.writeFileSync(OUTPUT, expected);
process.stdout.write(
  `gen:highlight: wrote static/highlight.min.js (${VERSION}, ${LANGUAGES.length} grammars, ${expected.length} bytes)\n`
);
