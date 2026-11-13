// The grammars `scripts/build-highlight.js` ships, plus '' for auto-detect.
//
// A literal list rather than a value read from v1's `application.js`: that
// file's `haste.extensionMap` is extension→language and is not exported, and a
// paste whose language this build does not carry falls back to auto-detect in
// the worker anyway.

export const LANGUAGES = [
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
] as const;
