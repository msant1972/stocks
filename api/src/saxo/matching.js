/**
 * Correspondência entre os instrumentos da aplicação (símbolos do Yahoo) e os da SAXO Bank (Uic + AssetType).
 * Funções puras: a pesquisa na SAXO e a gravação ficam em catalog.js e service.js.
 *
 * Regras (por ordem):
 *  1. ISIN (quando o catálogo o tem, sobretudo Euronext): um só candidato na bolsa certa → ligado.
 *  2. Raiz do símbolo (BAYN de BAYN.DE, NDA de NDA-FI.HE) na bolsa certa, com o nome da SAXO parecido com o do Yahoo.
 *  3. Nome da empresa na bolsa certa: o mais parecido, se for claro (≥ 0,6 e sem empate).
 * Sem nenhum destes: «ambíguo» (candidatos na bolsa certa), «só noutra bolsa» (ex.: Dublin → Londres) ou «não encontrado».
 * A bolsa compara-se pelo ExchangeId da SAXO, que é estável; o MIC varia (a Euronext Milão é MTAA no catálogo e XMIL na SAXO).
 */

/** Bolsa do Yahoo (campo `exchange` do catálogo) → ExchangeId da SAXO. */
export const SAXO_EXCHANGE = {
  Paris: 'PAR', Amsterdam: 'AMS', Brussels: 'BRU', Lisbon: 'LISB', Milan: 'MIL',
  XETRA: 'FSE', MCE: 'SIBE', Helsinki: 'HSE', Vienna: 'VIE', Irish: 'ISE', Dublin: 'ISE',
};

/** ExchangeId esperado: pela bolsa do Yahoo ou, sem ela, pelo MIC do catálogo (via /ref/v1/exchanges). */
export function expectedExchange(inst, micToExchange = new Map()) {
  return SAXO_EXCHANGE[inst.exchange] ?? (inst.mic ? micToExchange.get(String(inst.mic).toUpperCase()) ?? null : null);
}

/** Raiz do símbolo do Yahoo para pesquisar na SAXO: BAYN.DE → BAYN, NDA-FI.HE → NDA. */
export function symbolRoot(symbol) {
  return String(symbol).split('.')[0].split('-')[0].toUpperCase();
}

const STOP = new Set([
  'sa', 'se', 'ag', 'nv', 'n', 'v', 'plc', 'spa', 's', 'p', 'a', 'oyj', 'abp', 'ab', 'aktiengesellschaft', 'kgaa', 'co', 'kg',
  'the', 'group', 'groep', 'gruppe', 'grupo', 'gruppo', 'holding', 'holdings', 'ltd', 'limited', 'inc', 'corp', 'corporation',
  'company', 'societe', 'anonyme', 'europeenne', 'european', 'sgps', 'de', 'del', 'des', 'du', 'la', 'le', 'les', 'et', 'und',
  'of', 'and', 'y', 'e', 'di', 'ord', 'bearer', 'shares', 'reg', 'registered', 'class', 'cl', 'societa', 'per', 'azioni',
  'sociedad', 'anonima', 'aktiebolag', 'oy', 'nv/sa', 'sa/nv', 'bv', 'gmbh', 'se/ag', 'international', 'intl',
]);

/** Palavras significativas de um nome de empresa (minúsculas, sem acentos nem formas jurídicas). */
export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter((t) => t && !STOP.has(t));
}

const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Semelhança entre dois nomes de empresa, de 0 a 1: palavras em comum sobre as do nome mais curto
 * («Deutsche Bank Aktiengesellschaft» / «Deutsche Bank AG» = 1). Uma sigla conta se forem as iniciais do outro
 * nome («BBVA» / «Banco Bilbao Vizcaya Argentaria» = 1).
 */
export function nameScore(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  const initials = (t) => t.map((w) => w[0]).join('');
  if ((A.length === 1 && A[0].length >= 3 && A[0] === initials(B)) || (B.length === 1 && B[0].length >= 3 && B[0] === initials(A))) return 1;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const hits = short.filter((t) => long.some((u) => same(t, u))).length;
  return Math.round((hits / short.length) * 100) / 100;
}

export const NAME_OK = 0.6;     // nome claramente o mesmo
export const NAME_WEAK = 0.34;  // mínimo quando o símbolo também coincide

/** Candidato da SAXO (resultado de /ref/v1/instruments) no formato da aplicação. */
export function toCandidate(c, exchangeMic = new Map()) {
  return {
    uic: Number(c.Identifier), symbol: c.Symbol, description: c.Description ?? null, exchangeId: c.ExchangeId ?? null,
    mic: exchangeMic.get(c.ExchangeId) ?? null, currency: c.CurrencyCode ?? null, assetType: c.AssetType ?? null,
  };
}

/**
 * Decide a correspondência a partir dos candidatos já pesquisados.
 * inst: { symbol, name, currency }; cands: toCandidate(…); exchangeId: bolsa esperada (ou null); byIsin: vieram de uma
 * pesquisa por ISIN. Devolve { status: 'auto', candidate, rule, score } ou { status: 'ambiguous' | 'other_market' |
 * 'not_found', candidates } (candidatos com `nameScore`, os mais parecidos primeiro, no máximo 10).
 */
export function decideMatch(inst, cands, { exchangeId = null, byIsin = false } = {}) {
  const scored = cands
    .filter((c) => c.assetType == null || c.assetType === 'Stock')
    .map((c) => ({ ...c, nameScore: nameScore(inst.name, c.description) }))
    .sort((x, y) => y.nameScore - x.nameScore);
  const sameCcy = scored.filter((c) => c.currency === inst.currency);
  const onEx = exchangeId ? sameCcy.filter((c) => c.exchangeId === exchangeId) : [];
  const auto = (candidate, rule) => ({ status: 'auto', candidate, rule, score: candidate.nameScore });

  if (byIsin) {
    if (onEx.length === 1) return auto(onEx[0], 'isin');
    if (!exchangeId && sameCcy.length === 1) return auto(sameCcy[0], 'isin');
  }
  if (exchangeId) {
    const root = symbolRoot(inst.symbol).toLowerCase();
    const bySymbol = onEx.filter((c) => String(c.symbol).split(':')[0].toLowerCase() === root);
    if (bySymbol.length === 1 && bySymbol[0].nameScore >= NAME_WEAK) return auto(bySymbol[0], 'symbol');
    const [best, second] = onEx;
    if (best && best.nameScore >= NAME_OK && (!second || second.nameScore < best.nameScore)) return auto(best, 'name');
  }
  const list = (xs) => xs.slice(0, 10);
  if (onEx.length) return { status: 'ambiguous', candidates: list(onEx) };
  if (exchangeId && scored.some((c) => c.nameScore >= NAME_OK)) {
    return { status: 'other_market', candidates: list(scored.filter((c) => c.nameScore >= NAME_OK)) };
  }
  if (!exchangeId && sameCcy.length) return { status: 'ambiguous', candidates: list(sameCcy) };
  return { status: 'not_found', candidates: list(scored.filter((c) => c.nameScore >= NAME_WEAK)) };
}

/** Palavras do nome para a pesquisa por nome na SAXO (as duas primeiras significativas). */
export function nameKeywords(name) {
  return nameTokens(name).slice(0, 2).join(' ');
}
