// End-to-end encryption for secret pastes.
//
// The server never sees the passphrase or the plaintext: the record it stores
// carries a salt, an iteration count, an IV and the AES-GCM ciphertext, and the
// key is derived in the browser with PBKDF2-SHA-256. That is why a secret card
// has no `og:image` — the server cannot render text it cannot read.

import type { V2Cipher } from './types';

/** Recorded per paste, so a later change to the default leaves old ones readable. */
export const PBKDF2_ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** A secure context is required for `crypto.subtle`; there is no fallback. */
export const cryptoAvailable = (): boolean =>
  typeof crypto === 'object' && crypto !== null && typeof crypto.subtle?.deriveKey === 'function';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const deriveKey = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encrypt = async (passphrase: string, plaintext: string): Promise<V2Cipher> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: PBKDF2_ITERATIONS,
    data: toBase64(new Uint8Array(ciphertext))
  };
};

/**
 * Throws when the passphrase is wrong: AES-GCM authenticates, so a bad key is a
 * decryption failure rather than mojibake.
 */
export const decrypt = async (passphrase: string, cipher: V2Cipher): Promise<string> => {
  const key = await deriveKey(passphrase, fromBase64(cipher.salt), cipher.iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(cipher.iv) as BufferSource },
    key,
    fromBase64(cipher.data) as BufferSource
  );

  return new TextDecoder().decode(plaintext);
};
