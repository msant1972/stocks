import { useEffect, useState } from 'react';
import { useLogoConfig } from '../../lib/queries.js';
import { internalLogoUrl, logosEnabled } from '../../lib/logo.js';

/**
 * Logotipo do instrumento, guardado na aplicação (Administração → Logotipos). Sem logotipo, ou com os logotipos desligados
 * nas Definições, não mostra nada (o nome e o símbolo continuam ao lado).
 */
export default function InstrumentLogo({ instrumentId, logoVersion, size = 40, className = '' }) {
  const { data } = useLogoConfig();
  const url = logosEnabled(data) ? internalLogoUrl(instrumentId, logoVersion) : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return null;
  return <img className={`instrument-logo ${className}`} src={url} alt="" width={size} height={size} decoding="async" onError={() => setFailed(true)} />;
}
