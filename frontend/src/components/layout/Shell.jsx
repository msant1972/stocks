import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useMe, useStatus } from '../../lib/queries.js';
import Icon from '../ui/Icon.jsx';

const NAV = [
  { to: '/', label: 'Visão geral', icon: 'overview', end: true },
  { to: '/acompanhar', label: 'Acompanhar', icon: 'watch' },
  { to: '/orderbook', label: 'Orderbook', icon: 'orderbook' },
  { to: '/heatmap', label: 'HeatMap', icon: 'heatmap' },
  { to: '/carteira', label: 'Carteira', icon: 'portfolio' },
  { to: '/operacoes', label: 'Operações', icon: 'trades' },
  { to: '/sinais', label: 'Sinais', icon: 'signals' },
  { to: '/backtest', label: 'BackTest', icon: 'backtest' },
  { to: '/alertas', label: 'Alertas', icon: 'alerts' },
  { to: '/utilizadores', label: 'Utilizadores', icon: 'users', admin: true },
  { to: '/definicoes', label: 'Definições', icon: 'settings' },
];
const MOBILE_NAV = NAV.filter((n) => ['/', '/acompanhar', '/heatmap', '/sinais', '/carteira', '/alertas'].includes(n.to));

function DataStatus() {
  const { data } = useStatus();
  if (!data?.latestSession) return null;
  const age = f.daysSince(data.latestSession);
  const stale = age > 4;
  return (
    <span className={`badge ${stale ? 'badge-warning' : ''}`} title="Data da última sessão recolhida">
      {stale && <Icon name="warning" size={14} />}
      Dados de {f.date(data.latestSession)}
    </span>
  );
}

function TopSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      className="topbar-search" role="search"
      onSubmit={(e) => { e.preventDefault(); navigate(`/acompanhar?q=${encodeURIComponent(q.trim())}`); }}
    >
      <label htmlFor="top-search" className="visually-hidden">Pesquisar instrumentos</label>
      <input
        id="top-search" className="input" type="search" placeholder="Pesquisar (ex.: GALP)"
        value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: '2.5rem' }}
      />
    </form>
  );
}

export default function Shell() {
  const { data } = useMe();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => setNavOpen(false), [location.pathname]);

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    qc.clear();
    navigate('/entrar', { replace: true });
  }

  return (
    <div className="shell" data-nav-open={navOpen}>
      <a className="skip-link" href="#conteudo">Saltar para o conteúdo</a>
      <nav className="sidebar" aria-label="Principal">
        <Link to="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="brand-mark"><Icon name="trend" size={18} /></span>
          Stocks
        </Link>
        {NAV.filter((n) => !n.admin || data?.user.isAdmin).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
            <Icon name={n.icon} />{n.label}
          </NavLink>
        ))}
        <div className="sidebar-foot small muted">
          <p style={{ fontWeight: 500, color: 'var(--text)' }}>{data?.user.name}</p>
          <p>Simulação · sem dinheiro real</p>
          <button type="button" className="button button-ghost button-small" onClick={logout} style={{ marginTop: 8, paddingLeft: 0 }}>
            <Icon name="logout" size={18} />Terminar sessão
          </button>
        </div>
      </nav>
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="main-area">
        <header className="topbar">
          <button
            type="button" className="button button-ghost icon-button menu-button" aria-label="Abrir menu"
            aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}
          >
            <Icon name="menu" />
          </button>
          <TopSearch />
          <div className="topbar-right">
            <DataStatus />
            <Link to="/definicoes" className="button button-ghost icon-button mobile-only" aria-label="Definições e conta">
              <Icon name="settings" />
            </Link>
          </div>
        </header>
        <main id="conteudo" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Principal">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <Icon name={n.icon} size={22} />{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
