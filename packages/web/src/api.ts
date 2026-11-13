// The v2 JSON API, as the browser sees it.

import type { V2CreateRequest, V2Record } from './types';
import { bareKey } from './router';

export type CreateResponse = { ok: true; key: string } | { ok: false; message: string };

export const createDocument = async (request: V2CreateRequest): Promise<CreateResponse> => {
  let response: Response;
  try {
    response = await fetch('/v2/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });
  } catch {
    return { ok: false, message: 'Could not reach the server.' };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String(payload.message)
        : `Save failed (${String(response.status)}).`;
    return { ok: false, message };
  }

  const key =
    typeof payload === 'object' && payload !== null
      ? (payload as { key?: unknown }).key
      : undefined;
  if (typeof key !== 'string') return { ok: false, message: 'Save failed.' };

  return { ok: true, key };
};

export type ReadResponse =
  { ok: true; record: V2Record } | { ok: false; reason: 'not-found' | 'error' };

export const readDocument = async (id: string): Promise<ReadResponse> => {
  let response: Response;
  try {
    response = await fetch(`/v2/documents/${encodeURIComponent(bareKey(id))}`, {
      headers: { accept: 'application/json' }
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (response.status === 404) return { ok: false, reason: 'not-found' };
  if (!response.ok) return { ok: false, reason: 'error' };

  const record = (await response.json().catch(() => null)) as V2Record | null;
  if (!record || record.version !== 2) return { ok: false, reason: 'error' };

  return { ok: true, record };
};

/** Trigger a browser download of a blob the caller already produced. */
export const download = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
