// Syntax highlighting for the v2 card, on Shiki.
//
// v1 highlights with a Highlight.js worker it loads by relative URL. That
// worker ends with `importScripts('highlight.min.js')`, and `importScripts`
// resolves against the *worker's* URL — which a bundler gives a `blob:` URL, so
// the relative path is invalid and every message comes back with an empty
// result. Shiki is imported as modules instead of fetched as a script, so it
// has no such path assumption, and its TextMate grammars are what every editor
// (VS Code included) uses.
//
// The WASM-free JavaScript regex engine keeps the worker from needing a second
// file at a resolvable URL; the grammars and theme are bundled, so the first
// highlight costs a regex compile rather than a network round trip.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import { SHIKI_LANG_LOADERS } from './shiki-languages';
import { CARBON_THEME } from './carbon';

export interface WorkerRequest {
  id: number;
  text: string;
  language: string;
}

export interface WorkerResponse {
  id: number;
  /** Highlighted HTML, or `null` for plain text (the caller escapes it). */
  value: string | null;
  language: string;
}

let highlighter: Promise<HighlighterCore> | undefined;

const getHighlighter = (): Promise<HighlighterCore> => {
  highlighter ??= createHighlighterCore({
    themes: [CARBON_THEME],
    langs: SHIKI_LANG_LOADERS,
    engine: createJavaScriptRegexEngine()
  });
  return highlighter;
};

/** `vt100`, `vt`, `vb` and `vbs` are shiki aliases for the same grammar. */
const GRAMMAR_ALIASES: Record<string, string> = {
  // v1's language list names three grammars shiki ships under a different id.
  delphi: 'pascal',
  objectivec: 'objective-c',
  vbscript: 'vb'
};

const resolveGrammar = (language: string): string => GRAMMAR_ALIASES[language] ?? language;

const render = async (text: string, language: string): Promise<string | null> => {
  // `''` means auto-detect, which shiki has no equivalent for. Returning
  // `null` makes the caller escape the text, which is the honest result:
  // guessing a grammar would colour a paste wrong more often than not.
  if (language === '') return null;

  const hl = await getHighlighter();
  const wanted = resolveGrammar(language);

  if (!hl.getLoadedLanguages().includes(wanted)) return null;

  return hl.codeToHtml(text, { lang: wanted, theme: CARBON_THEME.name ?? 'carbon' });
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, text, language } = event.data;

  void render(text, language)
    .catch(() => null)
    .then((value) => {
      const response: WorkerResponse = { id, value, language };
      self.postMessage(response);
    });
};
