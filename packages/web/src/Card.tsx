// The Carbon-style card: a macOS window frame with a header and numbered code.
//
// One component serves the editor preview and the shared paste, so what an
// author sees before saving is what a reader sees afterwards — and it is laid
// out the same way as the server-side `og.ts` card, so the link preview matches
// too.

import type { ReactElement } from 'react';

import { highlightMarkup, useHighlighted } from './highlight';

const MAX_PREVIEW_LINES = 40;

export interface CardProps {
  title: string;
  language: string;
  code: string;
  /** Used when `title` is empty, and as the card's `aria-label`. */
  fallbackTitle: string;
}

export function Card({ title, language, code, fallbackTitle }: CardProps): ReactElement {
  const html = useHighlighted(code, language);

  const lines = code.split('\n');
  const shown = lines.slice(0, MAX_PREVIEW_LINES);
  const truncated = lines.length > MAX_PREVIEW_LINES;

  return (
    <div className="v2-card" aria-label={title || fallbackTitle} data-testid="v2-card">
      <div className="v2-card-header">
        <span className="v2-dot v2-dot-red" />
        <span className="v2-dot v2-dot-yellow" />
        <span className="v2-dot v2-dot-green" />
        <span className="v2-card-title">{title || fallbackTitle}</span>
      </div>
      <div className="v2-card-body">
        <pre className="v2-card-code hljs">
          <code
            // The worker returns escaped HTML from highlight.js; the fallback
            // path is escaped by `highlightMarkup` before it reaches here.
            dangerouslySetInnerHTML={{ __html: highlightMarkup(html, shown.join('\n')) }}
          />
        </pre>
        {truncated ? (
          <p className="v2-card-truncated">Showing the first {MAX_PREVIEW_LINES} lines.</p>
        ) : null}
      </div>
    </div>
  );
}
