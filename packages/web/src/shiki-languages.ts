// Shiki grammars, one per entry in the language picker.
//
// Explicit dynamic imports rather than `shiki/bundle/*`: the bundle carries
// every grammar shiki ships (hundreds), while this app advertises thirty. Vite
// code-splits each of these into its own chunk, so a paste only downloads the
// grammar it names.
//
// Three of v1's names are not shiki's: `delphi` is `pascal`, `objectivec` is
// `objective-c`, and `vbscript` is `vb`. The worker maps them.

import type { LanguageRegistration } from 'shiki/core';

export const SHIKI_LANG_LOADERS: Promise<{ default: LanguageRegistration[] }>[] = [
  import('shiki/langs/bash.mjs'),
  import('shiki/langs/coffeescript.mjs'),
  import('shiki/langs/cpp.mjs'),
  import('shiki/langs/css.mjs'),
  import('shiki/langs/pascal.mjs'),
  import('shiki/langs/diff.mjs'),
  import('shiki/langs/erlang.mjs'),
  import('shiki/langs/go.mjs'),
  import('shiki/langs/haskell.mjs'),
  import('shiki/langs/ini.mjs'),
  import('shiki/langs/java.mjs'),
  import('shiki/langs/javascript.mjs'),
  import('shiki/langs/json.mjs'),
  import('shiki/langs/latex.mjs'),
  import('shiki/langs/lisp.mjs'),
  import('shiki/langs/lua.mjs'),
  import('shiki/langs/markdown.mjs'),
  import('shiki/langs/objective-c.mjs'),
  import('shiki/langs/perl.mjs'),
  import('shiki/langs/php.mjs'),
  import('shiki/langs/python.mjs'),
  import('shiki/langs/ruby.mjs'),
  import('shiki/langs/scala.mjs'),
  import('shiki/langs/smalltalk.mjs'),
  import('shiki/langs/sql.mjs'),
  import('shiki/langs/swift.mjs'),
  import('shiki/langs/typescript.mjs'),
  import('shiki/langs/vala.mjs'),
  import('shiki/langs/vb.mjs'),
  import('shiki/langs/xml.mjs')
];
