import { useState } from 'react';
import { Button, Field } from '../../components/ui/controls.jsx';

/** Campo para o código de 6 dígitos da aplicação de autenticação (ou um código de recuperação). */
export function CodeField({ value, onChange, recovery = false, label, autoFocus = true }) {
  return (
    <Field label={label ?? (recovery ? 'Código de recuperação' : 'Código de 6 dígitos')}
      help={recovery ? 'Formato xxxxx-xxxxx. Cada código só pode ser usado uma vez.' : 'O código muda a cada 30 segundos.'}>
      {(p) => recovery ? (
        <input {...p} className="input num" autoComplete="off" spellCheck={false} autoCapitalize="off" autoFocus={autoFocus}
          maxLength={20} value={value} onChange={(e) => onChange(e.target.value)} placeholder="xxxxx-xxxxx" />
      ) : (
        <input {...p} className="input num code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" autoFocus={autoFocus}
          maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} placeholder="000000" />
      )}
    </Field>
  );
}

export const codeReady = (code, recovery) => (recovery ? code.replace(/[^a-z0-9]/gi, '').length === 10 : /^\d{6}$/.test(code));

/** Códigos de recuperação, mostrados uma única vez, com cópia e descarga. */
export function RecoveryCodes({ codes, email }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const header = `Stocks · códigos de recuperação${email ? ` · ${email}` : ''}\nCada código só pode ser usado uma vez.\n\n`;
    const url = URL.createObjectURL(new Blob([header + text + '\n'], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'stocks-codigos-recuperacao.txt' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack" style={{ gap: '0.75rem' }}>
      <ol className="recovery-codes num" aria-label="Códigos de recuperação">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="row" style={{ gap: 8 }}>
        <Button size="small" onClick={copy}>{copied ? 'Copiados' : 'Copiar'}</Button>
        <Button size="small" onClick={download}>Descarregar .txt</Button>
      </div>
    </div>
  );
}
