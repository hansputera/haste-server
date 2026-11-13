// The card: the carbon.now.sh window, reproduced.
//
// One component serves the editor preview and the shared paste, so what an
// author sees before saving is what a reader sees afterwards, and the
// server-rendered preview image (`packages/api/src/v2/og.ts`) draws the same
// geometry so a link unfurls the card the author was looking at.
//
// Design and measurements come from Carbon (https://carbon.now.sh), MIT
// licensed. See `carbon.ts` for the values and where each one was read from.

import type { ReactElement } from 'react';

import { CARBON_CONTROLS } from './carbon';
import { highlightMarkup, useHighlighted } from './highlight';

const MAX_PREVIEW_LINES = 40;

export interface CardProps {
  title: string;
  language: string;
  code: string;
  /** Used when `title` is empty, and as the card's `aria-label`. */
  fallbackTitle: string;
}

/** The three macOS window dots, as Carbon draws them: one 54×14 SVG. */
function WindowControls(): ReactElement {
  const { width, height, radius, strokeWidth, dots } = CARBON_CONTROLS;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <g fill="none" transform="translate(1 1)">
        {dots.map((dot, index) => (
          <circle
            key={dot.fill}
            cx={6 + index * 20}
            cy={6}
            r={radius}
            fill={dot.fill}
            stroke={dot.stroke}
            strokeWidth={strokeWidth}
          />
        ))}
      </g>
    </svg>
  );
}

export function Card({ title, language, code, fallbackTitle }: CardProps): ReactElement {
  const lines = code.split('\n');
  const shown = lines.slice(0, MAX_PREVIEW_LINES);
  const truncated = lines.length > MAX_PREVIEW_LINES;

  // Highlighted from what is displayed, not from the whole paste: a 2000-line
  // paste would otherwise pay to tokenise every line and then show forty.
  const preview = shown.join('\n');
  const html = useHighlighted(preview, language);

  return (
    <div className="carbon">
      <div className="carbon-window" aria-label={title || fallbackTitle} data-testid="v2-card">
        {/* Siblings, not nested: the dots sit 14px inside the window, while
            Carbon centres the title across the whole window. Nesting the title
            in the strip gave it the strip's 54px width to lay out in, so
            `left/right: 70px` collapsed it to nothing and the title vanished. */}
        <div className="carbon-controls">
          <WindowControls />
        </div>
        {title ? <div className="carbon-title">{title}</div> : null}
        <div className="carbon-body">
          <pre className="carbon-code">
            <code
              // Shiki returns escaped, self-contained HTML; the plain-text path
              // is escaped by `highlightMarkup` before it reaches here.
              dangerouslySetInnerHTML={{ __html: highlightMarkup(html, preview) }}
            />
          </pre>
          {truncated ? (
            <p className="carbon-truncated">Showing the first {MAX_PREVIEW_LINES} lines.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
