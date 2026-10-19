#!/usr/bin/env node
/**
 * orderbook <ISIN> <MIC> [--levels N] [--json] [--watch SEG] [--lang en] [--layout ladder]
 *
 * Códigos de saída (especificação §6.2): 0 OK · 2 argumentos inválidos · 3 instrumento sem dados /
 * não encontrado · 4 erro de rede/HTTP · 5 resposta em formato inesperado.
 */
import { parseArgs } from 'node:util';
import {
  computeStats, EncryptedResponseError, fetchOrderBook, InstrumentNotFoundError, InvalidInstrumentError,
  isValidIsin, isValidMic, MIN_WATCH_SEC, renderText, toJson, UnexpectedFormatError, UpstreamError, watchOrderBook,
} from './index.js';

const EXIT = { OK: 0, ARGS: 2, NOT_FOUND: 3, UPSTREAM: 4, FORMAT: 5 };

function exitCodeFor(err) {
  if (err instanceof InvalidInstrumentError) return EXIT.ARGS;
  if (err instanceof InstrumentNotFoundError) return EXIT.NOT_FOUND;
  if (err instanceof UpstreamError) return EXIT.UPSTREAM;
  if (err instanceof UnexpectedFormatError || err instanceof EncryptedResponseError) return EXIT.FORMAT;
  return EXIT.UPSTREAM;
}

const logger = {
  debug: process.env.DEBUG ? (o, m) => console.error(`[debug] ${m}`, o) : undefined,
  warn: (o, m) => console.error(`aviso: ${m}`),
};

function output(book, values) {
  const stats = computeStats(book);
  if (values.json) return JSON.stringify(toJson(book, stats), null, 2);
  return renderText(book, stats, { levels: values.levels ? Number(values.levels) : undefined, layout: values.layout });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        levels: { type: 'string' }, json: { type: 'boolean', default: false },
        watch: { type: 'string' }, lang: { type: 'string' }, layout: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    console.error(`erro: ${err.message}`);
    return EXIT.ARGS;
  }
  const { positionals, values } = parsed;
  if (values.help || positionals.length !== 2) {
    console.error('uso: orderbook <ISIN> <MIC> [--levels N] [--json] [--watch SEG] [--lang en] [--layout side-by-side|ladder]');
    return values.help ? EXIT.OK : EXIT.ARGS;
  }
  const [isin, mic] = positionals.map((s) => s.toUpperCase());
  if (!isValidIsin(isin) || !isValidMic(mic)) {
    console.error(`erro: ${!isValidIsin(isin) ? `ISIN inválido: ${isin}` : `MIC inválido: ${mic}`}`);
    return EXIT.ARGS;
  }
  if (values.levels && !/^\d+$/.test(values.levels)) { console.error('erro: --levels deve ser um inteiro'); return EXIT.ARGS; }
  if (values.layout && !['side-by-side', 'ladder'].includes(values.layout)) { console.error('erro: --layout inválido'); return EXIT.ARGS; }
  const opts = { logger, ...(values.lang ? { lang: values.lang } : {}) };

  if (values.watch) {
    if (!/^\d+$/.test(values.watch)) { console.error('erro: --watch deve ser um número de segundos'); return EXIT.ARGS; }
    const sec = Math.max(MIN_WATCH_SEC, Number(values.watch));
    if (Number(values.watch) < MIN_WATCH_SEC) console.error(`aviso: intervalo elevado para o mínimo de ${MIN_WATCH_SEC} s`);
    watchOrderBook(isin, mic, sec, (book) => {
      if (!values.json && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H'); // limpa o ecrã
      console.log(output(book, values));
    }, { ...opts, onError: (err) => console.error(`erro: ${err.message}`) });
    return new Promise(() => {}); // corre até Ctrl+C
  }

  try {
    console.log(output(await fetchOrderBook(isin, mic, opts), values));
    return EXIT.OK;
  } catch (err) {
    console.error(`erro: ${err.message}`);
    return exitCodeFor(err);
  }
}

main().then((code) => process.exit(code));
