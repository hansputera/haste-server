import { useEffect, useState, type ReactElement } from 'react';

import { Card } from './Card';
import { download, readDocument } from './api';
import { decrypt } from './crypto';
import type { V2Record } from './types';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed' }
  | { status: 'locked'; record: V2Record }
  | { status: 'ready'; record: V2Record; code: string; plain: boolean };

export function Viewer({ id }: { id: string }): ReactElement {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [passphrase, setPassphrase] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;

    void readDocument(id).then((result) => {
      if (!live) return;

      if (!result.ok) {
        setState({ status: result.reason === 'not-found' ? 'missing' : 'failed' });
        return;
      }

      const { record } = result;
      if (record.encrypted) setState({ status: 'locked', record });
      else setState({ status: 'ready', record, code: record.body ?? '', plain: false });
    });

    return () => {
      live = false;
    };
  }, [id]);

  const unlock = async (record: V2Record): Promise<void> => {
    if (!record.cipher) return;

    setBusy(true);
    setDecryptError(null);
    try {
      const code = await decrypt(passphrase, record.cipher);
      setState({ status: 'ready', record, code, plain: true });
    } catch {
      setDecryptError('Wrong passphrase, or this paste has already been read.');
    } finally {
      setBusy(false);
    }
  };

  const downloadPng = async (record: V2Record): Promise<void> => {
    const response = await fetch(`/v2/og/${encodeURIComponent(record.key)}.png`);
    if (!response.ok) {
      setDecryptError('The card could not be rendered.');
      return;
    }
    download(await response.blob(), `${record.key}.png`);
  };

  const copyLink = async (record: V2Record): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/v2/${record.key}`);
    } catch {
      setDecryptError('Copying needs a secure (https) context.');
    }
  };

  if (state.status === 'loading') return <p className="v2-loading">Loading…</p>;
  if (state.status === 'missing') return <p className="v2-missing">No such paste.</p>;
  if (state.status === 'failed') return <p className="v2-error">The paste could not be loaded.</p>;

  if (state.status === 'locked') {
    const { record } = state;
    return (
      <main className="v2-viewer">
        <h1 className="v2-title">{record.title || record.key}</h1>
        {record.description ? <p className="v2-description">{record.description}</p> : null}
        <div className="v2-unlock">
          <p className="v2-hint">
            This paste is encrypted. The passphrase never leaves this browser.
          </p>
          <label>
            Passphrase
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void unlock(record);
              }}
            />
          </label>
          <button type="button" onClick={() => void unlock(record)} disabled={busy || !passphrase}>
            {busy ? 'Decrypting…' : 'Decrypt'}
          </button>
          {record.burn ? (
            <p className="v2-warning">
              This paste burns after reading. A wrong passphrase consumes it too: the server deletes
              it on the first read, encrypted or not.
            </p>
          ) : null}
          {decryptError ? <p className="v2-error">{decryptError}</p> : null}
        </div>
      </main>
    );
  }

  const { record, code } = state;
  return (
    <main className="v2-viewer">
      <h1 className="v2-title">{record.title || record.key}</h1>
      {record.description ? <p className="v2-description">{record.description}</p> : null}

      <Card
        title={record.title}
        language={record.language || 'plaintext'}
        code={code}
        fallbackTitle={record.key}
      />

      <div className="v2-actions">
        <button type="button" onClick={() => void copyLink(record)}>
          Copy link
        </button>
        {/* A secret card is text only: the server cannot render what it cannot read. */}
        {state.plain ? null : (
          <button type="button" onClick={() => void downloadPng(record)}>
            Download PNG
          </button>
        )}
        <a href="/v2">New paste</a>
      </div>

      {record.burn ? <p className="v2-warning">This paste has now been read and deleted.</p> : null}
      {decryptError ? <p className="v2-error">{decryptError}</p> : null}
    </main>
  );
}
