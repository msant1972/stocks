import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useMe } from '../lib/queries.js';
import '../lib/theme.js'; // acompanha o tema do sistema quando a opção é «Sistema»
import Shell from '../components/layout/Shell.jsx';
import { ToastProvider } from '../components/feedback/Toast.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import OverviewPage from '../features/overview/OverviewPage.jsx';
import WatchlistPage from '../features/watchlist/WatchlistPage.jsx';
import InstrumentPage from '../features/instruments/InstrumentPage.jsx';
import PortfolioPage from '../features/portfolio/PortfolioPage.jsx';
import TradesPage from '../features/trades/TradesPage.jsx';
import AlertsPage from '../features/alerts/AlertsPage.jsx';
import SettingsPage from '../features/settings/SettingsPage.jsx';

function RequireSession({ children }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <div className="login-wrap" role="status"><span className="muted">A carregar…</span></div>;
  }
  if (me.isError) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
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
          <Route path="instrumentos/:id" element={<InstrumentPage />} />
          <Route path="carteira" element={<PortfolioPage />} />
          <Route path="operacoes" element={<TradesPage />} />
          <Route path="alertas" element={<AlertsPage />} />
          <Route path="definicoes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
