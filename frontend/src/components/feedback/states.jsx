import { errorMessage } from '../../lib/api.js';
import { Button, Notice } from '../ui/controls.jsx';

export function Skeleton({ height = 16, width = '100%', count = 1 }) {
  return (
    <div aria-hidden="true" className="stack" style={{ gap: 8 }}>
      {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ height, width }} />)}
    </div>
  );
}

export function Loading({ label = 'A carregar…', rows = 3 }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <Skeleton count={rows} height={20} />
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Notice tone="error">
      <p>{errorMessage(error)}</p>
      {onRetry && <Button size="small" onClick={onRetry} style={{ marginTop: 8 }}>Tentar de novo</Button>}
    </Notice>
  );
}
