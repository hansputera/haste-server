// The 1200×630 preview card for a v2 paste.
//
// Rendered on the server so a link unfurls the same everywhere: `satori` lays
// the element tree out to SVG, `@resvg/resvg-wasm` rasterises it to PNG. Neither
// needs a headless browser, which a serverless function cannot run anyway.
//
// The layout mirrors the Carbon card the web app shows, so the image a chat
// client attaches is the card the author was looking at. Colours are the
// Solarized dark palette v1 already uses.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

import { createLogger } from '../lib/log.js';
import { STATIC_ROOT } from '../lib/paths.js';
import type { V2Record } from './record.js';

const log = createLogger();

// The same object `packages/web/src/carbon.ts` draws, at the size a link
// preview needs. Geometry and colours are carbon.now.sh's (MIT): the window is
// scaled so the 56px outer padding, 5px radius, 14px control strip and 18/12px
// code padding all keep their proportions.
const WIDTH = 1200;
const HEIGHT = 630;
const LINES = 20;

const SCALE = WIDTH / 1200;
const PADDING = Math.round(56 * SCALE);
const RADIUS = Math.round(5 * SCALE);

// Measured from carbon.now.sh rather than read off its stylesheet: the control
// strip is 10px inside the window and the code's top padding is 48px, so the
// two overlap instead of stacking.
const CONTROL_TOP = Math.round(10 * SCALE);
const CONTROL_LEFT = Math.round(14 * SCALE);
const DOT_RADIUS = Math.round(6 * SCALE * 2);
const DOT_GAP = Math.round(20 * SCALE * 2);

const CODE_PADDING = {
  top: Math.round(48 * SCALE),
  right: Math.round(18 * SCALE),
  bottom: Math.round(18 * SCALE),
  left: Math.round(12 * SCALE)
};

// Carbon renders 14px code in a ~680px-wide window. Matching that ratio at
// this card's window width keeps the same visual density rather than scaling
// the type arbitrarily; 20 lines then fit the 630px frame.
const WINDOW_WIDTH = WIDTH - PADDING * 2;
const CODE_SIZE = Math.round((14 * (WINDOW_WIDTH - CODE_PADDING.left - CODE_PADDING.right)) / 568);
const CODE_LINE_HEIGHT = Math.round(CODE_SIZE * 1.33);

/** carbon.now.sh defaults: background, Seti editor, white title. */
const PAGE_BACKGROUND = '#abb8c3';
const WINDOW_BACKGROUND = '#151718';
const CODE_TEXT = '#cfd2d1';
const COMMENT = '#41535b';
const TITLE_TEXT = '#ffffff';
const DOTS = [
  { fill: '#FF5F56', stroke: '#E0443E' },
  { fill: '#FFBD2E', stroke: '#DEA123' },
  { fill: '#27C93F', stroke: '#1AAB29' }
];

const require = createRequire(import.meta.url);

// Resolved through `require.resolve`, not `new URL(..., import.meta.url)`: in a
// bundle the latter points at the bundle, which `src/lib/paths.ts` already
// records as a deployment failure. The fonts travel next to `static/`.
//
// Hack is Carbon's default face; DejaVu Sans Mono follows it so a paste with
// characters Hack lacks still renders.
const FONT_FAMILY = 'Hack';
const fontData = (file: string): Buffer => readFileSync(join(STATIC_ROOT, 'fonts', file));

const resvgBinary = (): Buffer => readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'));

// The wasm module can only be initialised once per process, and a second
// `initWasm` throws. The promise is shared so concurrent card renders await the
// same initialisation.
let wasmReady: Promise<void> | undefined;
const ensureWasm = (): Promise<void> => {
  wasmReady ??= Promise.resolve()
    .then(() => initWasm(resvgBinary()))
    .catch((error: unknown) => {
      // A failed initialisation must not be cached as ready.
      wasmReady = undefined;
      throw error;
    });
  return wasmReady;
};

interface Style {
  [property: string]: string | number | Style;
}

const box = (style: Style, children?: unknown): unknown => ({
  type: 'div',
  props: children === undefined ? { style } : { style, children }
});

const text = (value: string, style: Style): unknown => ({
  type: 'div',
  props: { style, children: value }
});

/** A window dot: Carbon strokes each circle by 0.5 at r=6. */
const dot = (fill: string, stroke: string, marginRight: number): unknown =>
  box({
    width: DOT_RADIUS * 2,
    height: DOT_RADIUS * 2,
    borderRadius: DOT_RADIUS,
    backgroundColor: fill,
    border: `${Math.max(1, Math.round(SCALE))}px solid ${stroke}`,
    marginRight
  });

/**
 * The window dots. Carbon draws them as one 54×14 SVG with a 0.5 stroke; the
 * stroke here is 1px because a sub-pixel border disappears once rasterised at
 * this size.
 *
 * The dots are boxes rather than characters: a `●` glyph makes satori fall back
 * to an emoji font, which renders a coloured pictograph instead of a dot.
 */
const controls = (): unknown =>
  box(
    {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      position: 'absolute',
      top: CONTROL_TOP,
      left: CONTROL_LEFT
    },
    DOTS.map((entry, index) =>
      dot(entry.fill, entry.stroke, index === DOTS.length - 1 ? 0 : DOT_GAP)
    )
  );

/**
 * Carbon centres the title across the whole window at
 * `max-width: calc(100% - 140px)`, which is why it is a sibling of the strip
 * placed against the window rather than a child of the strip.
 */
const titleBar = (title: string): unknown =>
  title
    ? text(title, {
        position: 'absolute',
        left: 70 * SCALE,
        right: 70 * SCALE,
        top: 9 * SCALE,
        textAlign: 'center',
        color: TITLE_TEXT,
        fontSize: Math.round(14 * (WIDTH / 680)),
        lineHeight: `${DOT_RADIUS * 2}px`,
        overflow: 'hidden',
        whiteSpace: 'nowrap'
      })
    : box({ display: 'none' });

const code = (record: V2Record): unknown => {
  if (record.encrypted) {
    // A secret paste has no body the server can read, so the card says that
    // rather than pretending the space is empty.
    return box(
      {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        justifyContent: 'center',
        padding: `${CODE_PADDING.top}px ${CODE_PADDING.right}px ${CODE_PADDING.bottom}px ${CODE_PADDING.left}px`,
        gap: CODE_LINE_HEIGHT / 2
      },
      [
        text('encrypted paste', {
          color: COMMENT,
          fontSize: CODE_SIZE,
          lineHeight: `${CODE_LINE_HEIGHT}px`
        }),
        ...(record.description
          ? [
              text(record.description, {
                color: CODE_TEXT,
                fontSize: Math.round(CODE_SIZE * 0.8),
                lineHeight: `${Math.round(CODE_LINE_HEIGHT * 0.8)}px`,
                maxHeight: CODE_LINE_HEIGHT * 3,
                overflow: 'hidden'
              })
            ]
          : [])
      ]
    );
  }

  const all = (record.body ?? '').split('\n');
  const lines = all.slice(0, LINES);
  if (all.length > LINES && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = `${lines[last] as string}…`;
  }

  return box(
    {
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
      padding: `${CODE_PADDING.top}px ${CODE_PADDING.right}px ${CODE_PADDING.bottom}px ${CODE_PADDING.left}px`
    },
    lines.map((line) =>
      text(line.length > 0 ? line : ' ', {
        color: CODE_TEXT,
        fontSize: CODE_SIZE,
        lineHeight: `${CODE_LINE_HEIGHT}px`,
        height: CODE_LINE_HEIGHT,
        whiteSpace: 'pre',
        overflow: 'hidden'
      })
    )
  );
};

const card = (record: V2Record): unknown =>
  box(
    {
      display: 'flex',
      flexDirection: 'column',
      width: WIDTH,
      height: HEIGHT,
      // Carbon paints the page behind the window; the window itself is the
      // rounded, shadowed rectangle inset by the padding.
      backgroundColor: PAGE_BACKGROUND,
      padding: PADDING,
      fontFamily: FONT_FAMILY
    },
    [
      box(
        {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          borderRadius: RADIUS,
          backgroundColor: WINDOW_BACKGROUND,
          overflow: 'hidden',
          position: 'relative'
        },
        [controls(), titleBar(record.title || record.key), code(record)]
      )
    ]
  );

export const renderCard = async (record: V2Record): Promise<Buffer> => {
  await ensureWasm();

  const svg = await satori(card(record) as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: FONT_FAMILY, data: fontData('Hack-Regular.ttf'), weight: 400, style: 'normal' },
      {
        name: 'DejaVu Sans Mono',
        data: fontData('DejaVuSansMono.ttf'),
        weight: 400,
        style: 'normal'
      }
    ]
  });

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();

  return Buffer.from(png);
};

export const renderCardOrLog = async (record: V2Record): Promise<Buffer | null> => {
  try {
    return await renderCard(record);
  } catch (error) {
    log.error({ key: record.key, error: String(error) }, 'og render failed');
    return null;
  }
};
