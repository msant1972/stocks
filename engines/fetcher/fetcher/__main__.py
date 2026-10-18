"""Linha de comandos do motor de recolha.

  python -m fetcher add ASML.AS SIE.DE        regista símbolos e pede a carga inicial
  python -m fetcher add --file lista.txt      um símbolo por linha (# para comentários)
  python -m fetcher run                       processa os pedidos pendentes
  python -m fetcher update                    pede a actualização diária e processa
  python -m fetcher status                    cobertura e estado de cada instrumento
  python -m fetcher indicators                recalcula EMA9 e SMA10/50/125/200 de todos os activos
"""
import argparse
import logging
import sys

from . import db
from .config import load_settings
from .provider import YFinanceProvider
from .service import run_pending
from .validation import normalise_symbol, symbol_error


def read_symbols(args) -> list[str]:
    raw = list(args.symbols)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            raw += [line.split("#", 1)[0] for line in fh]
    seen, out = set(), []
    for s in raw:
        s = normalise_symbol(s)
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def cmd_add(conn, args) -> int:
    errors = 0
    for symbol in read_symbols(args):
        if err := symbol_error(symbol):
            print(f"{symbol}: rejeitado ({err})")
            errors += 1
            continue
        _, created = db.add_instrument(conn, symbol)
        print(f"{symbol}: {'adicionado, carga inicial pedida' if created else 'já existe no catálogo'}")
    return 1 if errors else 0


def cmd_status(conn, args) -> int:
    rows = db.instrument_overview(conn)
    for r in rows:
        cover = f"{r['first_session']} a {r['last_session']}" if r["first_session"] else "sem dados"
        line = f"{r['symbol']:<12} {r['status']:<8} {r['sessions']:>4} sessões  {cover}"
        if r["status"] == "invalid":
            line += f"  ({r['status_reason']})"
        print(line)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="fetcher", description="Motor de recolha de cotações diárias")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    p_add = sub.add_parser("add", help="registar símbolos no catálogo")
    p_add.add_argument("symbols", nargs="*")
    p_add.add_argument("--file")
    sub.add_parser("run", help="processar pedidos pendentes")
    sub.add_parser("update", help="pedir actualização diária dos instrumentos activos e processar")
    sub.add_parser("status", help="mostrar cobertura e estado")
    sub.add_parser("indicators", help="recalcular os indicadores técnicos de todos os instrumentos activos")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    conn = db.connect(settings)
    try:
        if args.command == "add":
            return cmd_add(conn, args)
        if args.command == "status":
            return cmd_status(conn, args)
        if args.command == "indicators":
            print(f"indicadores recalculados para {db.recompute_all_indicators(conn)} instrumentos")
            return 0
        if args.command == "update":
            run_id = db.start_run(conn, "fetch_update")
            try:
                requested = db.enqueue_incremental(conn)
                n = run_pending(conn, YFinanceProvider(), settings)
            except Exception as exc:
                conn.rollback()
                db.finish_run(conn, run_id, False, f"erro: {exc}")
                raise
            failed = db.failed_jobs_since(conn, run_id)
            detail = f"{requested} actualizações pedidas, {n} pedidos processados, {failed} falhados"
            db.finish_run(conn, run_id, failed == 0, detail)
            print(detail)
            return 0
        n = run_pending(conn, YFinanceProvider(), settings)
        print(f"{n} pedidos processados")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
