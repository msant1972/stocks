import { PHASE_INFO, rangeNote } from '../../lib/wyckoff.js';

/**
 * Etiqueta da fase de Wyckoff de um instrumento. w: a linha de GET /wyckoff ({ phase, lateral, rangeSessions, volumeBias, … });
 * pending: ainda a carregar. Sem fase (histórico insuficiente) mostra um traço. A explicação vai no `title`.
 */
export default function PhaseBadge({ w, pending = false }) {
  if (pending) return <span className="muted" aria-label="A calcular">…</span>;
  const info = w && PHASE_INFO[w.phase];
  if (!info) return <span className="muted" title="Sem histórico suficiente (52 semanas de cotações)">—</span>;
  return <span className={`badge ${info.tone}`} title={[info.help, rangeNote(w)].filter(Boolean).join(' ')}>{info.label}</span>;
}
