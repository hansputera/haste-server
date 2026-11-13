// What the API stores, mirrored here so the client and the server agree on the
// wire format without sharing a build.
//
// `V2Cipher` holds everything needed to derive the key back: the salt and the
// iteration count are public by construction, and the passphrase never leaves
// the browser.

export interface V2Cipher {
  iv: string;
  salt: string;
  iterations: number;
  data: string;
}

export interface V2Record {
  version: 2;
  key: string;
  title: string;
  description: string;
  language: string;
  createdAt: string;
  burn: boolean;
  encrypted: boolean;
  /** Present on a v1 paste read through v2; never persisted. */
  legacy?: boolean;
  body?: string;
  cipher?: V2Cipher;
}

export interface V2CreateRequest {
  title?: string;
  description?: string;
  language?: string;
  body?: string;
  cipher?: V2Cipher;
  burn?: boolean;
}
