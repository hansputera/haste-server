// The carbon.now.sh design, as values rather than prose.
//
// Every number here was read from the Carbon source (github.com/carbon-app/carbon,
// MIT) rather than eyeballed, so the card in this app and the server-rendered
// preview image are the same object scaled — not two approximations of one.
//
//   lib/constants.js            DEFAULT_THEME (Seti) and its palette
//   components/Carbon.js        window radius, shadow, padding, code metrics
//   components/svg/Controls.js  the window dots
//
// The numeric values that only CSS consumes (padding, radius, shadow, font
// size) live in styles.css next to the rules that use them, annotated with the
// corresponding Carbon field, so there is no second copy to drift.
//
// Carbon is credited in the UI: see <CarbonCredit />.

import type { ThemeRegistration } from 'shiki/core';

/** The editor window: Carbon's default Seti theme, and its 5px radius. */
export const CARBON_WINDOW = {
  background: '#151718',
  text: '#CFD2D1'
} as const;

/** The 54×14 control strip from components/svg/Controls.js. */
export const CARBON_CONTROLS = {
  width: 54,
  height: 14,
  radius: 6,
  strokeWidth: 0.5,
  offset: 14,
  top: 34,
  dots: [
    { fill: '#FF5F56', stroke: '#E0443E' },
    { fill: '#FFBD2E', stroke: '#DEA123' },
    { fill: '#27C93F', stroke: '#1AAB29' }
  ]
} as const;

/**
 * Seti, the theme Carbon ships as its default. Shiki needs a TextMate theme
 * object; these are the same colours Carbon's `highlights` block lists.
 */
export const CARBON_THEME: ThemeRegistration = {
  name: 'carbon-seti',
  type: 'dark',
  colors: {
    'editor.background': CARBON_WINDOW.background,
    'editor.foreground': CARBON_WINDOW.text
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#41535b' }
    },
    {
      scope: ['string', 'string.quoted', 'punctuation.definition.string'],
      settings: { foreground: '#55b5db' }
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.character'],
      settings: { foreground: '#cd3f45' }
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier'],
      settings: { foreground: '#e6cd69' }
    },
    {
      scope: ['keyword.operator', 'punctuation.accessor'],
      settings: { foreground: '#9fca56' }
    },
    {
      scope: ['variable', 'variable.other', 'support.variable'],
      settings: { foreground: '#55b5db' }
    },
    {
      scope: ['variable.parameter', 'variable.language'],
      settings: { foreground: '#a074c4' }
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call'],
      settings: { foreground: '#55b5db' }
    },
    {
      scope: ['entity.name.tag', 'meta.tag', 'entity.other.attribute-name'],
      settings: { foreground: '#9fca56' }
    },
    {
      scope: ['support.type', 'support.class', 'entity.name.type', 'entity.name.class'],
      settings: { foreground: '#55b5db' }
    },
    {
      scope: ['meta', 'meta.preprocessor'],
      settings: { foreground: '#55b5db' }
    }
  ]
};
