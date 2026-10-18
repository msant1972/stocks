import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { keys, useInstrument, useQuotes } from '../../lib/queries.js';
import { InstrumentStatus, PriceChange, QuoteDate } from '../../components/finance/finance.jsx';
import { EmptyState, ErrorState, Loading } from '../../components/feedback/states.jsx';
import { useToast } from '../../components/feedback/Toast.jsx';
import { Button, Notice } from '../../components/ui/controls.jsx';
import TradeDialog from '../portfolio/TradeDialog.jsx';
import AlertDialog from '../alerts/AlertDialog.jsx';

// O gráfico (Recharts) só é carregado quando é preciso.
const DailyChart = lazy(() => import('../../components/finance/DailyChart.jsx'));

export default function InstrumentPage() {
  const { id } = useParams();
  const inst = useInstrument(id);
  const quotes = useQuotes(id, inst.data?.status === 'active');
  const qc = useQueryClient();
  const toast = useToast();
  const [trading, setTrading] = useState(false);
  const [alerting, setAlerting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (inst.isPending) return <Loading rows={6} />;
  if (inst.error) return <ErrorState error={inst.error} onRetry={inst.refetch} />;
  const i = inst.data;

  async function toggleWatch() {
    setBusy(true);
    setError(null);
    try {
      if (i.inWatchlist) await api.del(`/watchlist/items/${i.id}`);
      else await api.post('/watchlist/items', { instrumentId: i.id });
      await Promise.all([qc.invalidateQueries({ queryKey: keys.instrument(i.id) }), qc.invalidateQueries({ queryKey: keys.watchlist })]);
      toast(i.inWatchlist ? 'Removido da lista' : 'Adicionado à lista');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tradable = i.status === 'active' && i.currency === 'EUR' && i.latest;
  // A carga inicial começa dois anos antes do dia da recolha: tolera-se uma semana de diferença.
  const coverageLimit = i.lastSession && (() => {
    const [y, m, d] = i.lastSession.split('-').map(Number);
    return new Date(Date.UTC(y - 2, m - 1, d + 7)).toISOString().slice(0, 10);
  })();

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <h1 className="page-title">{i.symbol}</h1>
            <InstrumentStatus status={i.status} />
          </div>
          <p className="page-sub">{[i.name, i.exchange, i.currency].filter(Boolean).join(' · ') || 'Dados do instrumento ainda por confirmar'}</p>
        </div>
        <div className="row">
          <Button onClick={toggleWatch} busy={busy} disabled={i.status === 'invalid' && !i.inWatchlist}>
            {i.inWatchlist ? 'Remover da lista' : 'Adicionar à lista'}
          </Button>
          <Button onClick={() => setAlerting(true)} disabled={i.status === 'invalid'}>Criar alerta</Button>
          <Button variant="primary" onClick={() => setTrading(true)} disabled={!tradable}>Simular operação</Button>
        </div>
      </div>

      <div className="stack">
        {error && <Notice tone="error">{error}</Notice>}
        {i.status === 'pending' && (
          <Notice>
            A validar no fornecedor de dados: confirma-se que o símbolo existe e está cotado em EUR, e carregam-se até dois anos de histórico diário.
            Esta página actualiza-se sozinha.
            {i.fetch?.lastError && <> Última tentativa: {i.fetch.lastError}.</>}
          </Notice>
        )}
        {i.status === 'invalid' && <Notice tone="error">Instrumento inválido: {i.statusReason}.</Notice>}

        {i.latest && (
          <section className="card" aria-labelledby="quote-title">
            <h2 id="quote-title" className="visually-hidden">Última cotação</h2>
            <div className="spread" style={{ alignItems: 'flex-end' }}>
              <div>
                <p className="hero-value">{f.price(i.latest.close, i.currency)}</p>
                <div className="row" style={{ marginTop: 6 }}>
                  <PriceChange value={i.latest.changePct} />
                  <QuoteDate date={i.latest.date} />
                </div>
              </div>
              <div className="small muted meta-end">
                <p>{i.sessions} sessões disponíveis</p>
                <p>{f.date(i.firstSession)} a {f.date(i.lastSession)}</p>
              </div>
            </div>
            {coverageLimit && i.firstSession > coverageLimit && (
              <p className="small warning-text" style={{ marginTop: 12 }}>
                Cobertura inferior a dois anos: o fornecedor só tem dados desde {f.date(i.firstSession)}.
              </p>
            )}
            {i.currency && i.currency !== 'EUR' && (
              <p className="small warning-text" style={{ marginTop: 12 }}>Só são simuláveis instrumentos em EUR.</p>
            )}
          </section>
        )}

        {i.status === 'active' && (
          <section className="card" aria-labelledby="chart-title">
            <div className="card-head">
              <h2 id="chart-title" className="card-title">Histórico</h2>
            </div>
            {quotes.isPending ? <Loading rows={6} /> : quotes.error ? <ErrorState error={quotes.error} onRetry={quotes.refetch} /> :
              quotes.data.quotes.length === 0 ? <EmptyState title="Sem cotações disponíveis">O fornecedor não devolveu sessões para este instrumento.</EmptyState> :
                (
                  <Suspense fallback={<Loading rows={6} label="A carregar o gráfico…" />}>
                    <DailyChart quotes={quotes.data.quotes} currency={i.currency} symbol={i.symbol} />
                  </Suspense>
                )}
          </section>
        )}
      </div>

      <TradeDialog open={trading} onClose={() => setTrading(false)} instrument={i} />
      <AlertDialog open={alerting} onClose={() => setAlerting(false)} instrument={i} onDone={toast} />
    </>
  );
}
