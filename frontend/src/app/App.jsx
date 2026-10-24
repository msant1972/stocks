import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useMe } from '../lib/queries.js';
import '../lib/theme.js'; // acompanha o tema do sistema quando a opção é «Sistema»
import Shell from '../components/layout/Shell.jsx';
import { ToastProvider } from '../components/feedback/Toast.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import OverviewPage from '../features/overview/OverviewPage.jsx';
import WatchlistPage from '../features/watchlist/WatchlistPage.jsx';
import HeatmapPage from '../features/heatmap/HeatmapPage.jsx';
import OrderbookPage from '../features/orderbook/OrderbookPage.jsx';
import InstrumentPage from '../features/instruments/InstrumentPage.jsx';
import PortfolioPage from '../features/portfolio/PortfolioPage.jsx';
import TradesPage from '../features/trades/TradesPage.jsx';
import AlertsPage from '../features/alerts/AlertsPage.jsx';
import SignalsPage from '../features/signals/SignalsPage.jsx';
import BacktestPage from '../features/backtest/BacktestPage.jsx';
import SettingsPage from '../features/settings/SettingsPage.jsx';
import UsersPage from '../features/users/UsersPage.jsx';

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
          <Route path="orderbook" element={<OrderbookPage />} />
          <Route path="heatmap" element={<HeatmapPage />} />
          <Route path="instrumentos/:id" element={<InstrumentPage />} />
          <Route path="carteira" element={<PortfolioPage />} />
          <Route path="operacoes" element={<TradesPage />} />
          <Route path="sinais" element={<SignalsPage />} />
          <Route path="backtest" element={<BacktestPage />} />
          <Route path="alertas" element={<AlertsPage />} />
          <Route path="utilizadores" element={<UsersPage />} />
          <Route path="definicoes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
