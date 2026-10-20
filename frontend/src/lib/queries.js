import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from './api.js';

// Os dados mudam no máximo uma vez por dia: nada de polling frequente.
export const keys = {
  me: ['me'],
  status: ['status'],
  watchlist: ['watchlist'],
  portfolio: ['portfolio'],
  trades: (filters) => ['trades', filters],
  alerts: ['alerts'],
  alertEvents: ['alerts', 'events'],
  instrument: (id) => ['instrument', Number(id)],
  quotes: (id) => ['quotes', Number(id)],
  search: (q, sort, dir) => ['instruments', q, sort, dir],
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get('/me'), retry: false, staleTime: Infinity });
// Enquanto houver instrumentos «A validar», as listas voltam a ser consultadas a cada 5 s.
const POLL_PENDING_MS = 5_000;
const hasPending = (q) => q.state.data?.items?.some((i) => i.status === 'pending');

export const useStatus = () => useQuery({
  queryKey: keys.status, queryFn: () => api.get('/status'), staleTime: 5 * 60_000,
  refetchInterval: (q) => (q.state.data?.instruments.pending > 0 ? POLL_PENDING_MS : false),
});
export const useWatchlist = () => useQuery({
  queryKey: keys.watchlist, queryFn: () => api.get('/watchlist'),
  refetchInterval: (q) => (hasPending(q) ? POLL_PENDING_MS : false),
});
export const usePortfolio = () => useQuery({ queryKey: keys.portfolio, queryFn: () => api.get('/portfolio') });
export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: () => api.get('/alerts') });
export const useAlertEvents = () => useQuery({ queryKey: keys.alertEvents, queryFn: () => api.get('/alerts/events?limit=20') });

export function useTrades(filters = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v != null && v !== '')).toString();
  return useQuery({ queryKey: keys.trades(filters), queryFn: () => api.get(`/simulated-trades${qs ? `?${qs}` : ''}`) });
}

/** Detalhe do instrumento; enquanto está «A validar», volta a consultar a cada 10 s. */
export function useInstrument(id) {
  return useQuery({
    queryKey: keys.instrument(id),
    queryFn: () => api.get(`/instruments/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 10_000 : false),
  });
}

/**
 * Mid e desequilíbrio do livro Euronext dos instrumentos com ISIN-MIC, em lotes de 50 (o máximo da API).
 * A API limita a 4 os pedidos simultâneos à Euronext e guarda cada livro 30 s; sem actualização automática.
 * Os valores aparecem à medida que cada lote chega.
 */
const SUMMARY_BATCH = 50;
export function useOrderbookSummary(items) {
  const ids = (items ?? []).filter((i) => i.isinMic).map((i) => i.id).sort((a, b) => a - b);
  const batches = [];
  for (let k = 0; k < ids.length; k += SUMMARY_BATCH) batches.push(ids.slice(k, k + SUMMARY_BATCH).join(','));
  const results = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ['orderbook-summary', batch],
      queryFn: () => api.get(`/instruments/orderbook-summary?ids=${batch}`),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const byId = new Map(results.flatMap((r) => r.data?.items ?? []).map((i) => [i.id, i]));
  return { byId, isLoading: results.some((r) => r.isFetching && !r.data), isError: results.some((r) => r.isError) };
}

export function useQuotes(id, enabled) {
  return useQuery({ queryKey: keys.quotes(id), queryFn: () => api.get(`/instruments/${id}/quotes`), enabled });
}

/** Catálogo (50 primeiros). sort 'symbol', 'volume' ou 'change' ordena o catálogo inteiro no servidor. */
export function useInstrumentSearch(q, { sort = 'symbol', dir = 'asc' } = {}, enabled = true) {
  return useQuery({
    queryKey: keys.search(q, sort, dir),
    queryFn: () => api.get(`/instruments?limit=50&sort=${sort}&dir=${dir}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (hasPending(q) ? POLL_PENDING_MS : false),
  });
}
