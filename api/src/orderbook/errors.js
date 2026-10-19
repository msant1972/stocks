/** Erros do módulo euronext-orderbook (especificação §8). Todos incluem isin, mic e url. */
export class OrderBookError extends Error {
  constructor(message, { isin = null, mic = null, url = null, excerpt = undefined, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.isin = isin;
    this.mic = mic;
    this.url = url;
    if (excerpt !== undefined) this.excerpt = excerpt;
  }
}

/** ISIN ou MIC com formato ou dígito de controlo inválido; nenhum pedido HTTP é feito. */
export class InvalidInstrumentError extends OrderBookError {}
/** HTTP 404 ou HTML em vez de JSON. */
export class InstrumentNotFoundError extends OrderBookError {}
/** Rede, timeout, HTTP 429 ou 5xx depois de esgotadas as novas tentativas. */
export class UpstreamError extends OrderBookError {}
/** JSON sem chart_data e sem table. */
export class UnexpectedFormatError extends OrderBookError {}
/** Resposta no formato cifrado ajax_secure ({ct, iv, s}); decifração fica para uma versão futura. */
export class EncryptedResponseError extends OrderBookError {}

/** Avisos não fatais (§5.6, §5.7): o resultado é devolvido na mesma. */
export const WARNING = {
  INCONSISTENCY: 'OrderBookInconsistencyWarning',
  MALFORMED_LEVEL: 'MalformedLevelWarning',
  ORDERS_UNMATCHED: 'OrdersUnmatchedWarning',
};
