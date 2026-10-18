from datetime import date
from decimal import Decimal as D

from fetcher import db, indicators
from fetcher.service import run_pending

from .conftest import FakeProvider


def test_sma_janela_movel():
    closes = [D(x) for x in ("1", "2", "3", "4", "5")]
    assert indicators.sma(closes, 3) == [None, None, D("2"), D("3"), D("4")]


def test_ema_iniciada_com_sma():
    closes = [D(x) for x in range(1, 12)]  # 1..11
    out = indicators.ema(closes, 9)
    assert out[:8] == [None] * 8
    assert out[8] == D("5")                       # SMA das primeiras 9: (1+…+9)/9
    assert out[9] == D("6")                       # 0,2×10 + 0,8×5
    assert out[10] == D("7")                      # 0,2×11 + 0,8×6


def test_compute_devolve_colunas_pela_ordem():
    closes = [D(100 + i) for i in range(200)]
    rows = indicators.compute(closes)
    assert len(rows) == 200
    ema9, sma10, sma50, sma125, sma200 = rows[-1]
    assert sma10 == D("294.5")                    # média de 290..299
    assert sma200 == D("199.5")
    assert rows[198][4] is None and rows[199][4] is not None
    assert indicators.compute([]) == []


def test_recolha_grava_indicadores_sobre_o_fecho_ajustado(conn, settings):
    db.add_instrument(conn, "TESTE.LS")
    run_pending(conn, FakeProvider(), settings, today=date(2026, 10, 16))
    with conn.cursor() as cur:
        cur.execute(
            "SELECT session_date, adj_close, ema9, sma10, sma50, sma125, sma200 FROM daily_quotes "
            "ORDER BY session_date"
        )
        rows = cur.fetchall()
    conn.commit()
    adj = [r["adj_close"] for r in rows]
    assert rows[8]["ema9"] is not None and rows[7]["ema9"] is None
    assert rows[198]["sma200"] is None and rows[199]["sma200"] == indicators.sma(adj, 200)[199]
    assert rows[-1]["sma10"] == sum(adj[-10:]) / 10
