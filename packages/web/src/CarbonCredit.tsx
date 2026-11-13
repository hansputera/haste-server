// Attribution for the card design.
//
// The card reproduces carbon.now.sh: its window, dot controls, spacing and
// colours are copied from Carbon's own components, and Carbon is MIT licensed,
// which keeps the attribution requirement. Rendered wherever the card is, so
// the credit travels with the design rather than sitting in a source comment.

import type { ReactElement } from 'react';

export function CarbonCredit(): ReactElement {
  return (
    <p className="carbon-credit">
      Card design by{' '}
      <a href="https://carbon.now.sh" target="_blank" rel="noreferrer noopener">
        carbon.now.sh
      </a>{' '}
      (MIT)
    </p>
  );
}
