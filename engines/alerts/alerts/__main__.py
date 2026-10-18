"""Linha de comandos do motor de alertas.

  python -m alerts run              avalia as regras e envia um resumo por utilizador
  python -m alerts run --dry-run    mostra os resumos no terminal sem enviar nem gravar nada
"""
import argparse
import logging
import sys

from .config import load_settings
from .mailer import PrintMailer, SmtpMailer
from .service import connect, run


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="alerts", description="Motor de alertas por email")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    p_run = sub.add_parser("run", help="avaliar regras e enviar resumos")
    p_run.add_argument("--dry-run", action="store_true", help="mostrar os emails sem enviar nem gravar")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    if args.dry_run:
        mailer = PrintMailer(sys.stdout)
    elif settings.smtp is None:
        print("erro: STOCKS_SMTP_HOST não definido; use --dry-run ou configure o SMTP", file=sys.stderr)
        return 2
    else:
        mailer = SmtpMailer(settings.smtp)

    conn = connect(settings)
    try:
        result = run(conn, settings, mailer, dry_run=args.dry_run)
    finally:
        conn.close()
    print(("[dry-run] " if args.dry_run else "") + result.summary())
    return 1 if result.errors else 0


if __name__ == "__main__":
    sys.exit(main())
