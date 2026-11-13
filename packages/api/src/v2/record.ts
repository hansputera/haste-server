// The v2 document format.
//
// v2 pastes share the store and the key space with v1, so every one of the
// seven backends works unchanged: a v1 value is raw text, a v2 value is a
// marker-prefixed JSON string. The marker is what lets `createDocumentService`
// keep a v2 record off `/documents/:id` and `/raw/:id` without a second store.
//
// A secret paste is encrypted in the browser (AES-GCM, key derived with
// PBKDF2), so `cipher` holds only what the server needs to hand back: the salt
// and iteration count are public by construction, and the record never carries
// the passphrase.

export const V2_MARKER = 'haste:v2:';

export interface V2Cipher {
  /** Standard base64. */
  iv: string;
  /** Standard base64. */
  salt: string;
  /** PBKDF2-SHA-256 iterations the browser used, so an old paste stays readable. */
  iterations: number;
  /** Standard base64 AES-GCM ciphertext. */
  data: string;
}

export interface V2Record {
  version: 2;
  key: string;
  /** '' when absent. */
  title: string;
  /** '' when absent. */
  description: string;
  /** A highlight.js grammar name; '' means auto-detect. */
  language: string;
  /** ISO 8601. */
  createdAt: string;
  burn: boolean;
  encrypted: boolean;
  /** Plaintext, only when `encrypted` is false. */
  body?: string;
  /** Only when `encrypted` is true. */
  cipher?: V2Cipher;
}

export const serializeRecord = (record: V2Record): string => V2_MARKER + JSON.stringify(record);

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCipher = (value: unknown): value is V2Cipher =>
  isRecordLike(value) &&
  typeof value.iv === 'string' &&
  typeof value.salt === 'string' &&
  typeof value.iterations === 'number' &&
  typeof value.data === 'string';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Parse a stored value into a v2 record, or `null` for anything else — a v1
 * body, a v2 value from a newer format, or a truncated write.
 */
export const parseRecord = (value: string): V2Record | null => {
  if (!value.startsWith(V2_MARKER)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(V2_MARKER.length));
  } catch {
    return null;
  }

  if (!isRecordLike(parsed) || parsed.version !== 2) return null;
  if (typeof parsed.key !== 'string' || typeof parsed.body !== 'string') {
    // A record is either a plaintext body or a cipher; an encrypted one carries
    // no body at all.
    if (!isRecordLike(parsed) || !isCipher(parsed.cipher)) return null;
  }

  const encrypted = parsed.encrypted === true;
  if (encrypted && !isCipher(parsed.cipher)) return null;
  if (!encrypted && typeof parsed.body !== 'string') return null;

  return {
    version: 2,
    key: text(parsed.key),
    title: text(parsed.title),
    description: text(parsed.description),
    language: text(parsed.language),
    createdAt: text(parsed.createdAt),
    burn: parsed.burn === true,
    encrypted,
    ...(encrypted ? { cipher: parsed.cipher as V2Cipher } : { body: parsed.body as string })
  };
};
