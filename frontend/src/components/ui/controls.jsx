import { useEffect, useId, useRef } from 'react';
import Icon from './Icon.jsx';

export function Button({ variant = 'secondary', size, busy = false, className = '', children, disabled, ...rest }) {
  const cls = ['button', variant === 'primary' && 'button-primary', variant === 'ghost' && 'button-ghost',
    variant === 'danger' && 'button-danger', size === 'small' && 'button-small', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

/** Campo com rótulo persistente, ajuda e erro associados ao controlo. */
export function Field({ label, help, error, children, id: forcedId }) {
  const auto = useId();
  const id = forcedId ?? auto;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && <p id={helpId} className="field-help">{help}</p>}
      {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Modal sobre o elemento <dialog> nativo: mantém o foco dentro, fecha com Escape e devolve o foco
 * ao elemento que o abriu.
 */
export function Dialog({ open, onClose, title, children, labelledBy }) {
  const ref = useRef(null);
  const opener = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref} className="modal" aria-labelledby={labelledBy ?? titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={() => { if (open) onClose(); opener.current?.focus?.(); }}
    >
      {open && (
        <div className="modal-body">
          <div className="modal-head">
            <h2 id={titleId} className="modal-title">{title}</h2>
            <button type="button" className="button button-ghost icon-button" onClick={onClose} aria-label="Fechar">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </label>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }) {
  return (
    <div className={`notice ${tone === 'warning' ? 'notice-warning' : tone === 'error' ? 'notice-error' : ''}`}
      role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={tone === 'info' ? 'info' : 'warning'} />
      <div>{children}</div>
    </div>
  );
}
