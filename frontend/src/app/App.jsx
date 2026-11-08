import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useMe } from '../lib/queries.js';
import '../lib/theme.js'; // acompanha o tema do sistema quando a opção é «Sistema»
import Shell from '../components/layout/Shell.jsx';
import { ToastProvider } from '../components/feedback/Toast.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import OverviewPage from '../features/overview/OverviewPage.jsx';

// As restantes páginas são carregadas só quando abertas (o Shell mostra a espera dentro do layout).
const WatchlistPage = lazy(() => import('../features/watchlist/WatchlistPage.jsx'));
const ChartsPage = lazy(() => import('../features/charts/ChartsPage.jsx'));
const HeatmapPage = lazy(() => import('../features/heatmap/HeatmapPage.jsx'));
const TimelapsePage = lazy(() => import('../features/timelapse/TimelapsePage.jsx'));
const OrderbookPage = lazy(() => import('../features/orderbook/OrderbookPage.jsx'));
const InstrumentRedirect = lazy(() => import('../features/instruments/InstrumentRedirect.jsx'));
const SaxoOrdersPage = lazy(() => import('../features/saxo/SaxoOrdersPage.jsx'));
const SaxoPortfolioPage = lazy(() => import('../features/saxo/SaxoPortfolioPage.jsx'));
const SaxoAlertsPage = lazy(() => import('../features/saxo/SaxoAlertsPage.jsx'));
const SaxoAutomationPage = lazy(() => import('../features/saxo/SaxoAutomationPage.jsx'));
const SaxoMatchPage = lazy(() => import('../features/saxo/SaxoMatchPage.jsx'));
const AlertsPage = lazy(() => import('../features/alerts/AlertsPage.jsx'));
const SignalsPage = lazy(() => import('../features/signals/SignalsPage.jsx'));
const ComparePage = lazy(() => import('../features/compare/ComparePage.jsx'));
const BacktestPage = lazy(() => import('../features/backtest/BacktestPage.jsx'));
const WinnersLosersPage = lazy(() => import('../features/winners/WinnersLosersPage.jsx'));
const PromessasPage = lazy(() => import('../features/promessas/PromessasPage.jsx'));
const PechinchasPage = lazy(() => import('../features/pechinchas/PechinchasPage.jsx'));
const CalorPage = lazy(() => import('../features/calor/CalorPage.jsx'));
const LabPage = lazy(() => import('../features/lab/LabPage.jsx'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.jsx'));
const UsersPage = lazy(() => import('../features/users/UsersPage.jsx'));

function RequireSession({ children }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <div className="login-wrap" role="status"><span className="muted">A carregar…</span></div>;
  }
  // Sem sessão, ou com a autenticação em dois passos por concluir: o ecrã de entrada trata do passo em falta.
  if (me.isError || !me.data || me.data.mfa.pending) return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route element={<RequireSession><Shell /></RequireSession>}>
          <Route index element={<OverviewPage />} />
          <Route path="acompanhar" element={<WatchlistPage />} />
          <Route path="charts" element={<ChartsPage />} />
          <Route path="orderbook" element={<OrderbookPage />} />
          <Route path="heatmap" element={<HeatmapPage />} />
          <Route path="timelapse" element={<TimelapsePage />} />
          <Route path="instrumentos/:id" element={<InstrumentRedirect />} />
          <Route path="carteira" element={<Navigate to="/saxo/carteira" replace />} />
          <Route path="operacoes" element={<Navigate to="/saxo/ordens" replace />} />
          <Route path="saxo" element={<Navigate to="/saxo/ordens" replace />} />
          <Route path="saxo/carteira" element={<SaxoPortfolioPage />} />
          <Route path="saxo/ordens" element={<SaxoOrdersPage />} />
          <Route path="saxo/alertas" element={<SaxoAlertsPage />} />
          <Route path="saxo/automacao" element={<SaxoAutomationPage />} />
          <Route path="saxo/correspondencia" element={<SaxoMatchPage />} />
          <Route path="sinais" element={<SignalsPage />} />
          <Route path="backtest" element={<BacktestPage />} />
          <Route path="comparar" element={<ComparePage />} />
          <Route path="winners-loosers" element={<WinnersLosersPage />} />
          <Route path="promessas" element={<PromessasPage />} />
          <Route path="pechinchas" element={<PechinchasPage />} />
          <Route path="calor" element={<CalorPage />} />
          <Route path="laboratorio" element={<LabPage />} />
          <Route path="alertas" element={<AlertsPage />} />
          <Route path="utilizadores" element={<UsersPage />} />
          <Route path="definicoes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
