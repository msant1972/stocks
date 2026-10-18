"""Linha de comandos do motor de alertas.

  python -m alerts run                          avalia as regras e envia um resumo por utilizador
  python -m alerts run --dry-run                mostra os resumos no terminal sem enviar nem gravar nada
  python -m alerts run --dry-run-if-unconfigured  como run, mas em --dry-run se não houver SMTP configurado
  python -m alerts test --to ana@exemplo.pt     envia um email de teste com a configuração SMTP actual

A configuração SMTP vem de Definições (tabela smtp_settings); na sua falta, das variáveis STOCKS_SMTP_*.
"""
import argparse
import logging
import sys
from email.message import EmailMessage

from .config import load_settings, resolve_smtp
from .mailer import PrintMailer, SendFailed, SendUncertain, SmtpMailer
from .secrets import load_key
from .service import connect, run


def test_message(sender: str, recipient: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Stocks: email de teste"
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content(
        "Este é um email de teste da aplicação Stocks.\n\n"
        "Se o recebeu, a configuração SMTP está correcta e os resumos de alertas serão enviados por esta via."
    )
    return msg


def cmd_test(smtp, to: str) -> int:
    if smtp is None:
        print("SMTP não configurado: preencha a configuração em Definições")
        return 2
    try:
        SmtpMailer(smtp).send(test_message(smtp.sender, to))
    except SendUncertain as exc:
        print(f"resultado incerto: {exc}")
        return 1
    except SendFailed as exc:
        print(f"falha no envio: {exc}")
        return 1
    print(f"email de teste enviado para {to} via {smtp.host}:{smtp.port}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="alerts", description="Motor de alertas por email")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    p_run = sub.add_parser("run", help="avaliar regras e enviar resumos")
    p_run.add_argument("--dry-run", action="store_true", help="mostrar os emails sem enviar nem gravar")
    p_run.add_argument("--dry-run-if-unconfigured", action="store_true",
                       help="usar --dry-run quando não houver configuração SMTP")
    p_test = sub.add_parser("test", help="enviar um email de teste")
    p_test.add_argument("--to", required=True)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    conn = connect(settings)
    try:
        try:
            smtp = resolve_smtp(conn, settings, load_key())
        except (RuntimeError, ValueError) as exc:
            print(f"erro na configuração SMTP: {exc}", file=sys.stderr)
            return 2
        if args.command == "test":
            return cmd_test(smtp, args.to)

        dry_run = args.dry_run
        if smtp is None and not dry_run:
            if not args.dry_run_if_unconfigured:
                print("erro: SMTP não configurado (Definições ou STOCKS_SMTP_*); use --dry-run", file=sys.stderr)
                return 2
            print("SMTP não configurado: alertas em --dry-run, nenhum email enviado", file=sys.stderr)
            dry_run = True
        mailer = PrintMailer(sys.stdout) if dry_run else SmtpMailer(smtp)
        settings = settings.__class__(**{**settings.__dict__, "smtp": smtp})
        result = run(conn, settings, mailer, dry_run=dry_run)
    finally:
        conn.close()
    print(("[dry-run] " if dry_run else "") + result.summary())
    return 1 if result.errors else 0


if __name__ == "__main__":
    sys.exit(main())
