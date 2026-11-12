import { useEffect, useState } from 'react';
import { useLogoConfig } from '../../lib/queries.js';
import { internalLogoUrl, logosEnabled } from '../../lib/logo.js';

/** Logotipo por omissão («Logo»), para os instrumentos sem logotipo guardado. */
export function DefaultLogo({ size = 40, className = '' }) {
  return (
    <span className={`instrument-logo logo-default ${className}`} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.28)) }}>Logo</span>
  );
}

/**
 * Logotipo do instrumento, guardado na aplicação (Administração → Logotipos); sem ele (ou se a imagem falhar), o logotipo
 * por omissão. Com os logotipos desligados nas Definições, não mostra nada.
 */
export default function InstrumentLogo({ instrumentId, logoVersion, size = 40, className = '' }) {
  const { data } = useLogoConfig();
  const url = internalLogoUrl(instrumentId, logoVersion);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!logosEnabled(data)) return null;
  if (!url || failed) return <DefaultLogo size={size} className={className} />;
  return <img className={`instrument-logo ${className}`} src={url} alt="" width={size} height={size} decoding="async" onError={() => setFailed(true)} />;
}
