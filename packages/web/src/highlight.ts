// Syntax highlighting, off the main thread.
//
// The worker is the one v1 already ships (`static/highlight-worker.js`), served
// from the static root rather than duplicated under `/v2`: the protocol is
// `{ id, text, language }` in, `{ id, value, language }` out, so a v2 card and a
// v1 paste are highlighted by the same bundle and cannot drift.

import { useEffect, useRef, useState } from 'react';

interface WorkerRequest {
  id: number;
  text: string;
  language: string;
}

interface WorkerResponse {
  id: number;
  value: string | null;
  language: string;
}

export const WORKER_URL = '/highlight-worker.js';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let nextId = 1;

/** The highlighted markup, or `null` while the worker is still working. */
export const useHighlighted = (code: string, language: string): string | null => {
  const [html, setHtml] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // `null` tells the worker "no highlighting": plain text still needs the
    // escaping a `textContent` would do, which the renderer below relies on.
    if (language === 'plaintext') {
      setHtml(null);
      return;
    }

    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(WORKER_URL);
      } catch {
        // A CSP that forbids workers degrades to plain text, never to nothing.
        setHtml(null);
        return;
      }
    }

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
 * Markup for a pre block: highlighted HTML when the worker answered, escaped
 * plain text otherwise.
 */
export const highlightMarkup = (html: string | null, code: string): string =>
  html ?? escapeHtml(code);
