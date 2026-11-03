/** Mini-gráfico de linha (SVG) para resumos. label descreve a série a leitores de ecrã. */
export default function Sparkline({ values, label, tone = 'positive' }) {
  if (!values || values.length < 2) return null;
  const w = 160;
  const h = 44;
  const pad = 3;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values
    .map((v, i) => `${(pad + (i / (values.length - 1)) * (w - 2 * pad)).toFixed(1)},${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={label} preserveAspectRatio="none" style={{ maxWidth: '14rem', display: 'block' }}>
      <polyline points={points} fill="none" stroke={`var(--${tone})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
