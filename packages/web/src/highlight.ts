// Highlighting, off the main thread.
//
// The worker is built by Vite (`new Worker(new URL(...), { type: 'module' })`),
// so shiki's grammars arrive as real module imports rather than as a script
// fetched by relative path — the failure mode that left v2 unhighlighted when
// it reused v1's `importScripts`-based worker.

import { useEffect, useRef, useState } from 'react';

import type { WorkerFailure, WorkerRequest, WorkerResponse } from './highlight.worker';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let nextId = 1;

/**
 * Highlighted markup for `code`, or `null` while the worker is still working,
 * when the language has no grammar, or when the answer on hand is for different
 * text.
 *
 * The markup is stored with the text it was produced from, and only returned
 * while that text is still current. Without this the previous paste's markup
 * outlives its input: deleting a character kept showing the old text until the
 * worker replied, and emptying the editor left the whole previous paste on the
 * card.
 */
export const useHighlighted = (code: string, language: string): string | null => {
  const [rendered, setRendered] = useState<{ forCode: string; html: string | null } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current ??= new Worker(new URL('./highlight.worker.ts', import.meta.url), {
      type: 'module'
    });

    const worker = workerRef.current;
    const id = nextId++;

    const onMessage = (event: MessageEvent<WorkerResponse | WorkerFailure>): void => {
      if (event.data.id !== id) return;
      // A failure is recorded as `null` markup and read as plain text: the card
      // then renders escaped text, which is a readable paste rather than a
      // blank one.
      setRendered({
        forCode: code,
        html: 'value' in event.data ? event.data.value : null
      });
    };

    worker.addEventListener('message', onMessage);
    const request: WorkerRequest = { id, text: code, language };
    worker.postMessage(request);

    return () => worker.removeEventListener('message', onMessage);
  }, [code, language]);

  // Terminated on real unmount only, and deliberately not in an effect cleanup:
  // StrictMode mounts, unmounts and remounts, so an unmount cleanup kills the
  // worker the remount then reuses — a terminated worker accepts `postMessage`
  // and never answers, which is exactly the "no highlighting, no error" symptom
  // this whole hook exists to avoid.
  useEffect(() => {
    const onUnload = (): void => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };

    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  // Stale markup is worse than none: `highlightMarkup` falls back to escaped
  // text, which always matches the editor.
  return rendered?.forCode === code ? rendered.html : null;
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
