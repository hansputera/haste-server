// The v2 domain layer: create a paste, read one, delete one.
//
// Framework-free like `core.ts` — nothing here imports `hono`, so the specs
// exercise it without an HTTP server. Keys come from the v1 `DocumentService`
// rather than a second generator: the two surfaces share a store and a key
// space, so a key that v1 would consider free must not be handed out twice.

import { createLogger, type Logger } from '../lib/log.js';
import type { Config, DocumentStore } from '../lib/types.js';
import type { DocumentService } from '../core.js';
import { parseRecord, serializeRecord, type V2Cipher, type V2Record } from './record.js';

const log = createLogger();

export interface CreateInput {
  title?: string;
  description?: string;
  language?: string;
  body?: string;
  cipher?: V2Cipher;
  burn?: boolean;
}

export type CreateResult = { ok: true; key: string } | { ok: false; reason: CreateFailure };
export type CreateFailure = 'too-long' | 'invalid' | 'store';

export type ReadResult = { ok: true; record: V2Record } | { ok: false; reason: ReadFailure };
export type ReadFailure = 'not-found' | 'store';

export interface V2Service {
  create(input: CreateInput): Promise<CreateResult>;
  /** Reads a record and, for a burn paste, deletes it: this is the one consuming read. */
  read(key: string): Promise<ReadResult>;
  /** Reads a record without consuming it, for previews the author did not ask for. */
  peek(key: string): Promise<ReadResult>;
  remove(key: string): Promise<void>;
}

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;
const MAX_LANGUAGE = 32;

const removeStore = (store: DocumentStore, key: string): Promise<boolean> =>
  new Promise((resolve) => store.remove(key, resolve));

const getStore = (store: DocumentStore, key: string): Promise<string | false> =>
  new Promise((resolve) => store.get(key, resolve, true));

const setStore = (store: DocumentStore, key: string, data: string): Promise<boolean> =>
  new Promise((resolve) => store.set(key, data, resolve, true));

const withinLimit = (value: string | undefined, limit: number): boolean =>
  value === undefined || value.length <= limit;

export const createV2Service = (
  store: DocumentStore,
  service: DocumentService,
  config: Config,
  serviceLog: Logger = log
): V2Service => {
  const maxLength = config.maxLength ?? 400_000;

  // The single place that turns a key into a record, so the consuming and
  // non-consuming reads can never disagree about what a record is.
  const load = async (key: string): Promise<ReadResult> => {
    const bare = key.split('.')[0] as string;

    try {
      const value = await getStore(store, bare);
      const record = value ? parseRecord(value) : null;
      return record ? { ok: true, record } : { ok: false, reason: 'not-found' };
    } catch (error) {
      serviceLog.error({ key: bare, error: String(error) }, 'v2 read failed');
      return { ok: false, reason: 'store' };
    }
  };

  return {
    async create(input: CreateInput): Promise<CreateResult> {
      const hasBody = typeof input.body === 'string';
      const hasCipher = input.cipher !== undefined;

      // Exactly one of the two: a record is either stored in the clear or
      // encrypted in the browser, never both.
      if (hasBody === hasCipher) return { ok: false, reason: 'invalid' };

      if (
        !withinLimit(input.title, MAX_TITLE) ||
        !withinLimit(input.description, MAX_DESCRIPTION) ||
        !withinLimit(input.language, MAX_LANGUAGE)
      ) {
        return { ok: false, reason: 'invalid' };
      }

      if (hasBody && (input.body as string).length > maxLength) {
        return { ok: false, reason: 'too-long' };
      }

      let key: string;
      try {
        key = await service.chooseKey();
      } catch (error) {
        serviceLog.error({ error: String(error) }, 'v2 key selection failed');
        return { ok: false, reason: 'store' };
      }

      const record: V2Record = {
        version: 2,
        key,
        title: input.title ?? '',
        description: input.description ?? '',
        language: input.language ?? '',
        createdAt: new Date().toISOString(),
        burn: input.burn === true,
        encrypted: hasCipher,
        ...(hasCipher ? { cipher: input.cipher } : { body: input.body })
      };

      const stored = await setStore(store, key, serializeRecord(record));
      if (!stored) return { ok: false, reason: 'store' };

      return { ok: true, key };
    },

    async read(key: string): Promise<ReadResult> {
      const result = await load(key);

      // A burn paste is served once. The delete happens before the caller sees
      // the record: a failed delete still returns it (read-your-write beats a
      // paste the author believes was consumed), and the error line is what an
      // operator sees.
      if (result.ok && result.record.burn) {
        const removed = await removeStore(store, result.record.key).catch(() => false);
        if (!removed) serviceLog.error({ key: result.record.key }, 'burn failed');
      }

      return result;
    },

    // A page view or a link unfurl is not a read of the content: a chat client
    // fetching `/v2/<key>` and its card must not destroy a burn paste before the
    // recipient opens it.
    peek(key: string): Promise<ReadResult> {
      return load(key);
    },

    async remove(key: string): Promise<void> {
      const bare = key.split('.')[0] as string;

      try {
        const removed = await removeStore(store, bare);
        if (!removed) serviceLog.error({ key: bare }, 'v2 delete failed');
      } catch (error) {
        serviceLog.error({ key: bare, error: String(error) }, 'v2 delete failed');
      }
    }
  };
};
