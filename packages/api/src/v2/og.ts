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

const WIDTH = 1200;
const HEIGHT = 630;
const LINES = 20;
const FONT_SIZE = 28;
const LINE_HEIGHT = 36;
const PADDING = 48;

const BACKGROUND = '#002b36';
const HEADER_TEXT = '#eee8d5';
const BODY_TEXT = '#93a1a1';
const DOTS = ['#ff5f56', '#ffbd2e', '#27c93f'];
const LINE_NUMBER = '#586e75';

const require = createRequire(import.meta.url);

// Resolved through `require.resolve`, not `new URL(..., import.meta.url)`: in a
// bundle the latter points at the bundle, which `src/lib/paths.ts` already
// records as a deployment failure. The font travels next to `static/`.
const fontData = (): Buffer => readFileSync(join(STATIC_ROOT, 'fonts', 'DejaVuSansMono.ttf'));

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

const dot = (color: string): unknown =>
  box({
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color,
    marginRight: 10
  });

const header = (title: string): unknown =>
  box(
    {
      display: 'flex',
      alignItems: 'center',
      padding: `18px ${PADDING}px`,
      backgroundColor: '#073642',
      borderBottom: '1px solid #586e75'
    },
    [
      box({ display: 'flex', flexDirection: 'row' }, DOTS.map(dot)),
      // Space is taken by the dots row; the title sits centred in what is left.
      text(title, {
        flexGrow: 1,
        textAlign: 'center',
        color: HEADER_TEXT,
        fontSize: 24,
        marginLeft: -78,
        overflow: 'hidden',
        whiteSpace: 'nowrap'
      })
    ]
  );

const body = (record: V2Record): unknown => {
  if (record.encrypted) {
    return box(
      {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        justifyContent: 'center',
        padding: `${PADDING}px`,
        gap: 18
      },
      [
        text('encrypted paste', { color: LINE_NUMBER, fontSize: FONT_SIZE }),
        ...(record.description
          ? [
              text(record.description, {
                color: BODY_TEXT,
                fontSize: 24,
                maxHeight: LINE_HEIGHT * 3,
                overflow: 'hidden'
              })
            ]
          : [])
      ]
    );
  }

  const lines = (record.body ?? '').split('\n').slice(0, LINES);
  const truncated = (record.body ?? '').split('\n').length > LINES;
  if (truncated && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = `${lines[last] as string}…`;
  }

  return box(
    {
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1,
      padding: `${PADDING - 16}px ${PADDING}px`
    },
    lines.map((line, index) =>
      box({ display: 'flex', flexDirection: 'row', height: LINE_HEIGHT }, [
        text(String(index + 1), {
          color: LINE_NUMBER,
          fontSize: FONT_SIZE * 0.7,
          width: 56,
          height: LINE_HEIGHT,
          textAlign: 'right',
          marginRight: 20
        }),
        text(line.length > 0 ? line : ' ', {
          color: BODY_TEXT,
          fontSize: FONT_SIZE,
          height: LINE_HEIGHT,
          whiteSpace: 'pre',
          overflow: 'hidden'
        })
      ])
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
      backgroundColor: BACKGROUND,
      fontFamily: 'DejaVu Sans Mono',
      overflow: 'hidden'
    },
    [header(record.title || record.key), body(record)]
  );

export const renderCard = async (record: V2Record): Promise<Buffer> => {
  await ensureWasm();

  const svg = await satori(card(record) as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: 'DejaVu Sans Mono', data: fontData(), weight: 400, style: 'normal' }]
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
