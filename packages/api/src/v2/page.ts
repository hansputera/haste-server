// The `/v2` shell with a paste's preview tags injected.
//
// Vite builds the SPA with hashed asset names and one marker in `<head>`, so the
// page route serves the built file verbatim except for that marker — rewriting
// asset URLs here would break the moment Vite renames a chunk. The marker is
// `<!--haste:og-->` in `packages/web/index.html`; its absence is a bug in that
// file, and `renderV2Page` leaves the document untouched rather than emitting
// meta tags between an unclosed pair.

export const OG_MARKER = '<!--haste:og-->';
export const OG_MARKER_END = '<!--/haste:og-->';

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute path to the card, or `null` to omit `og:image` entirely. */
  imageUrl: string | null;
  url: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttribute = escapeHtml;

export const renderV2Page = (html: string, meta: PageMeta): string => {
  const start = html.indexOf(OG_MARKER);
  if (start === -1) return html;

  // Everything between the markers is defaults the shell ships for hosts that
  // serve the file directly; it is replaced, not appended to, so a page never
  // carries two <title> elements.
  const end = html.indexOf(OG_MARKER_END, start);
  if (end === -1) return html;

  const title = escapeHtml(meta.title);
  const description = escapeAttribute(meta.description);
  const url = escapeAttribute(meta.url);

  const tags = [
    `<title>${title}</title>`,
    `<meta property="og:title" content="${title}"/>`,
    `<meta property="og:description" content="${description}"/>`,
    `<meta property="og:url" content="${url}"/>`,
    `<meta property="og:type" content="article"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`
  ];

  // A paste with no card must not advertise one: an `og:image` pointing at a
  // 404 renders worse in every client than no image at all.
  if (meta.imageUrl) {
    tags.push(
      `<meta property="og:image" content="${escapeAttribute(meta.imageUrl)}"/>`,
      '<meta property="og:image:width" content="1200"/>',
      '<meta property="og:image:height" content="630"/>'
    );
  }

  return (
    html.slice(0, start) +
    OG_MARKER +
    '\n    ' +
    tags.join('\n    ') +
    '\n    ' +
    OG_MARKER_END +
    html.slice(end + OG_MARKER_END.length)
  );
};
