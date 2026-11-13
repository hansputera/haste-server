import { useState, type ReactElement } from 'react';

import { Card } from './Card';
import { createDocument } from './api';
import { cryptoAvailable, encrypt } from './crypto';
import { LANGUAGES } from './languages';

export function Editor(): ReactElement {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('');
  const [code, setCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [burn, setBurn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const secretAvailable = cryptoAvailable();
  const secret = passphrase.length > 0 && secretAvailable;

  const save = async (): Promise<void> => {
    setError(null);
    setSaved(null);
    setSaving(true);

    try {
      const shared = { title, description, language, burn };

      const response = secret
        ? await createDocument({ ...shared, cipher: await encrypt(passphrase, code) })
        : await createDocument({ ...shared, body: code });

      if (!response.ok) {
        setError(response.message);
        return;
      }

      setSaved(`${window.location.origin}/v2/${response.key}`);
    } catch {
      setError('Encryption failed; the paste was not saved.');
    } finally {
      setSaving(false);
    }
  };

  const reset = (): void => {
    setTitle('');
    setDescription('');
    setLanguage('');
    setCode('');
    setPassphrase('');
    setBurn(false);
    setError(null);
    setSaved(null);
  };

  return (
    <main className="v2-editor">
      <header className="v2-head">
        <h1>
          <a href="/">haste</a> <span className="v2-version">v2</span>
        </h1>
        <button type="button" className="v2-secondary" onClick={reset}>
          New
        </button>
      </header>

      <div className="v2-fields">
        <label>
          Title
          <input
            type="text"
            value={title}
            maxLength={200}
            placeholder="Optional"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Description
          <input
            type="text"
            value={description}
            maxLength={500}
            placeholder="Optional; shown in link previews"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">Auto-detect</option>
            {LANGUAGES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="v2-code-field">
        Code
        <textarea
          spellCheck={false}
          value={code}
          placeholder="Paste or type here…"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>

      <div className="v2-options">
        <label className="v2-secret">
          Secret passphrase
          <input
            type="password"
            value={passphrase}
            disabled={!secretAvailable}
            placeholder={secretAvailable ? 'Optional; encrypts in this browser' : ''}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          {secretAvailable ? null : (
            <span className="v2-hint">Secret pastes need a secure (https) context</span>
          )}
        </label>

        <label className="v2-burn">
          <input
            type="checkbox"
            checked={burn}
            onChange={(event) => setBurn(event.target.checked)}
          />
          Burn after reading
          <span className="v2-hint">
            {secret
              ? 'A single read consumes the paste, even with the wrong passphrase.'
              : 'The paste is deleted the first time it is read.'}
          </span>
        </label>
      </div>

      <Card title={title} language={language} code={code} fallbackTitle="untitled" />

      <div className="v2-actions">
        <button type="button" onClick={() => void save()} disabled={saving || code.length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved ? (
          <p className="v2-saved">
            <a href={saved}>{saved}</a>
          </p>
        ) : null}
        {error ? <p className="v2-error">{error}</p> : null}
      </div>
    </main>
  );
}
