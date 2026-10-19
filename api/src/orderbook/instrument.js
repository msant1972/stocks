/** Identificação Euronext de um instrumento: ISIN + MIC (especificação §3.1 e §6.3). */

export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
export const MIC_RE = /^[A-Z0-9]{4}$/;

/** Dígito de controlo do ISIN: letras convertidas em números (A=10 … Z=35) e algoritmo de Luhn. */
export function isValidIsin(isin) {
  if (typeof isin !== 'string' || !ISIN_RE.test(isin)) return false;
  const digits = isin.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const isValidMic = (mic) => typeof mic === 'string' && MIC_RE.test(mic);

/** "PTFCP0AM0008-XLIS" → { isin, mic }, ou null se o formato ou o dígito de controlo forem inválidos. */
export function parseIsinMic(value) {
  const m = /^([A-Z0-9]{12})-([A-Z0-9]{4})$/.exec(String(value ?? '').trim().toUpperCase());
  if (!m || !isValidIsin(m[1]) || !isValidMic(m[2])) return null;
  return { isin: m[1], mic: m[2] };
}

/** Fuso do carimbo «Updated» por MIC (§6.3). */
export function marketTimeZone(mic) {
  if (mic === 'XLIS') return 'Europe/Lisbon';
  if (mic === 'XDUB' || mic === 'XMSM') return 'Europe/Dublin';
  return 'Europe/Paris';
}

/** MIC sugerido a partir da bolsa devolvida pelo fornecedor de cotações (só mercados Euronext). */
const EXCHANGE_MIC = {
  Lisbon: 'XLIS', Paris: 'XPAR', Amsterdam: 'XAMS', Brussels: 'XBRU',
  Milan: 'MTAA', Irish: 'XMSM', Dublin: 'XMSM', Oslo: 'XOSL',
};
export const suggestMic = (exchange) => EXCHANGE_MIC[exchange] ?? null;

/**
 * Converte uma data/hora local de um fuso (sem indicação de fuso) para um Date em UTC,
 * usando o Intl para conhecer o desvio desse fuso nesse instante (inclui horário de Verão).
 */
export function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - instant;
  };
  let utc = guess - offset(guess);
  utc = guess - offset(utc); // segunda passagem acerta os instantes perto da mudança de hora
  return new Date(utc);
}
