import { useEffect, useState } from 'react';
import { useLogoConfig } from '../../lib/queries.js';
import { activeClientId, domainOf, logoUrl } from '../../lib/logo.js';

/**
 * Logotipo do instrumento (Brandfetch), a partir do site da empresa. Sem chave configurada, sem site ou sem logotipo na
 * Brandfetch, não mostra nada (o nome e o símbolo continuam ao lado).
 */
export default function InstrumentLogo({ website, size = 40, className = '' }) {
  const { data } = useLogoConfig();
  const url = logoUrl(domainOf(website), activeClientId(data), size);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return null;
  return (
    <img className={`instrument-logo ${className}`} src={url} alt="" width={size} height={size} loading="lazy" decoding="async"
      referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)} />
  );
}
