import { useQuery } from '@tanstack/react-query';
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
  search: (q) => ['instruments', q],
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get('/me'), retry: false, staleTime: Infinity });
export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: () => api.get('/status'), staleTime: 5 * 60_000 });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: () => api.get('/watchlist') });
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

export function useQuotes(id, enabled) {
  return useQuery({ queryKey: keys.quotes(id), queryFn: () => api.get(`/instruments/${id}/quotes`), enabled });
}

export function useInstrumentSearch(q, enabled = true) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.get(`/instruments?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}
