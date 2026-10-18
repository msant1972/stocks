from datetime import date
from decimal import Decimal as D

from alerts.digest import DigestEvent, build_message, describe, fmt_number
from alerts.rules import change_pct, evaluate


def test_alerta_de_nivel_dispara_so_na_transicao():
    assert evaluate("close_above", D("10"), D("11"), D("9"), None).fire
    assert evaluate("close_above", D("10"), D("11"), D("9"), False).fire
    assert not evaluate("close_above", D("10"), D("11"), D("10.5"), True).fire
    assert evaluate("close_above", D("10"), D("11"), None, True).state
    assert not evaluate("close_above", D("10"), D("10"), D("9"), None).state  # estritamente acima
    assert evaluate("close_below", D("10"), D("9.99"), None, None).fire
    assert not evaluate("close_below", D("10"), D("9.99"), None, True).fire


def test_alerta_de_variacao_avalia_cada_sessao():
    assert change_pct(D("105"), D("100")) == D("5.0000")
    assert evaluate("change_up", D("5"), D("105"), D("100"), True).fire
    assert not evaluate("change_up", D("5"), D("104.99"), D("100"), None).fire
    assert evaluate("change_down", D("3"), D("97"), D("100"), True).fire
    assert not evaluate("change_down", D("3"), D("97.01"), D("100"), None).fire
    assert not evaluate("change_up", D("1"), D("100"), None, None).fire  # sem sessão anterior


def test_formatacao_portuguesa():
    assert fmt_number(D("12345.678")) == "12 345,68"
    assert fmt_number(D("-0.5")) == "-0,50"
    assert fmt_number(D("999")) == "999,00"
    e = DigestEvent("GALP.LS", "Galp", "change_down", D("3"), date(2026, 10, 16), D("15.2"), D("-3.4567"))
    assert describe(e) == "descida de pelo menos 3,00% numa sessão: fecho de 15,20 € (-3,46% face à sessão anterior) em 16 out. 2026"


def test_mensagem_de_resumo():
    events = [
        DigestEvent("SIE.DE", None, "close_above", D("200"), date(2026, 10, 16), D("201.5"), None),
        DigestEvent("GALP.LS", "Galp <Energia>", "close_below", D("15"), date(2026, 10, 16), D("14.9"), None),
    ]
    msg = build_message("alertas@graus.pt", "ana@exemplo.pt", "Ana", events, "https://stocks.graus.pt")
    assert msg["Subject"] == "Stocks: 2 alertas · sessão de 16 out. 2026"
    text = msg.get_body(preferencelist=("plain",)).get_content()
    assert text.index("GALP.LS") < text.index("SIE.DE")
    assert "https://stocks.graus.pt/alertas" in text
    assert "não em tempo real" in text
    html = msg.get_body(preferencelist=("html",)).get_content()
    assert "Galp &lt;Energia&gt;" in html
