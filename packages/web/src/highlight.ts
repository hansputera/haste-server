// Highlighting, off the main thread.
//
// The worker is built by Vite (`new Worker(new URL(...), { type: 'module' })`),
// so shiki's grammars arrive as real module imports rather than as a script
// fetched by relative path — the failure mode that left v2 unhighlighted when
// it reused v1's `importScripts`-based worker.

import { useEffect, useRef, useState } from 'react';

import type { WorkerRequest, WorkerResponse } from './highlight.worker';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let nextId = 1;

/**
 * Highlighted markup for `code`, or `null` while the worker is still working or
 * when the language has no grammar.
 */
export const useHighlighted = (code: string, language: string): string | null => {
  const [html, setHtml] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current ??= new Worker(new URL('./highlight.worker.ts', import.meta.url), {
      type: 'module'
    });

    const worker = workerRef.current;
    const id = nextId++;

    const onMessage = (event: MessageEvent<WorkerResponse>): void => {
      if (event.data.id !== id) return;
      setHtml(event.data.value);
    };

    worker.addEventListener('message', onMessage);
    const request: WorkerRequest = { id, text: code, language };
    worker.postMessage(request);

    return () => worker.removeEventListener('message', onMessage);
  }, [code, language]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    []
  );

  return html;
};

/**
 * Markup for a code block: highlighted HTML when the worker answered, escaped
 * plain text otherwise. Shiki emits `<pre><code>…</code></pre>`; the card wants
 * the inner content only, because it owns the block's own layout.
 */
export const highlightMarkup = (html: string | null, code: string): string => {
  if (!html) return escapeHtml(code);

  const inner = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html);
  return inner ? (inner[1] as string) : escapeHtml(code);
};
