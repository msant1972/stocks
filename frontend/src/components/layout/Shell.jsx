import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import * as f from '../../lib/format.js';
import { useMe, useStatus } from '../../lib/queries.js';
import Icon from '../ui/Icon.jsx';
import { Loading } from '../feedback/states.jsx';
import { Dialog } from '../ui/controls.jsx';

// Menu em secções; Utilizadores só aparece aos administradores.
const NAV_GROUPS = [
  { items: [{ to: '/', label: 'Visão geral', icon: 'overview', end: true }] },
  {
    title: 'Mercado',
    items: [
      { to: '/acompanhar', label: 'Acompanhar', icon: 'watch' },
      { to: '/charts', label: 'Charts', icon: 'charts' },
      { to: '/orderbook', label: 'Orderbook', icon: 'orderbook' },
      { to: '/heatmap', label: 'HeatMap', icon: 'heatmap' },
    ],
  },
  {
    title: 'Carteira',
    items: [
      { to: '/carteira', label: 'Carteira', icon: 'portfolio' },
      { to: '/operacoes', label: 'Operações', icon: 'trades' },
      { to: '/alertas', label: 'Alertas', icon: 'alerts' },
    ],
  },
  {
    title: 'SAXO',
    items: [
      { to: '/saxo/carteira', label: 'Carteira SAXO', icon: 'portfolio' },
      { to: '/saxo/ordens', label: 'Ordens SAXO', icon: 'trades' },
      { to: '/saxo/alertas', label: 'Alertas SAXO', icon: 'alerts' },
      { to: '/saxo/correspondencia', label: 'Correspondência SAXO', icon: 'link', admin: true },
    ],
  },
  {
    title: 'Estratégias',
    items: [
      { to: '/sinais', label: 'Sinais', icon: 'signals' },
      { to: '/backtest', label: 'BackTest', icon: 'backtest' },
      { to: '/comparar', label: 'Comparar', icon: 'compare' },
      { to: '/winners-loosers', label: 'WinnersLoosers', icon: 'winners' },
      { to: '/promessas', label: 'Promessas', icon: 'promise' },
      { to: '/pechinchas', label: 'Pechinchas', icon: 'bargain' },
      { to: '/calor', label: 'Calor', icon: 'heat' },
    ],
  },
  {
    title: 'Conta',
    items: [
      { to: '/utilizadores', label: 'Utilizadores', icon: 'users', admin: true },
      { to: '/definicoes', label: 'Definições', icon: 'settings' },
    ],
  },
];
const visibleGroups = (isAdmin) => NAV_GROUPS
  .map((g) => ({ ...g, items: g.items.filter((n) => !n.admin || isAdmin) }))
  .filter((g) => g.items.length);
// Atalhos da barra inferior em telemóvel; todos os módulos ficam no botão «Mais».
const MOBILE_SHORTCUTS = ['/', '/acompanhar', '/charts', '/carteira', '/sinais'];
const MOBILE_NAV = NAV_GROUPS.flatMap((g) => g.items).filter((n) => MOBILE_SHORTCUTS.includes(n.to));

function DataStatus() {
  const { data } = useStatus();
  if (!data?.latestSession) return null;
  const age = f.daysSince(data.latestSession);
  const stale = age > 4;
  // Sessão em curso: a última recolha foi a horária (depois da diária) e já trouxe a sessão de hoje.
  const intraday = data.lastIntradayRun;
  const daily = data.lastFetchRun;
  const live = intraday?.finishedAt && (!daily || intraday.startedAt > daily.startedAt) && age === 0;
  const time = live ? new Date(intraday.finishedAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <span className={`badge ${stale ? 'badge-warning' : ''}`}
      title={live ? 'Sessão em curso: valores provisórios, com cerca de 20 minutos de atraso; o fecho definitivo é gravado às 19h01' : 'Data da última sessão recolhida'}>
      {stale && <Icon name="warning" size={14} />}
      Dados de {f.date(data.latestSession)}{live && ` · sessão em curso, ${time}`}
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
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => { setNavOpen(false); setMoreOpen(false); }, [location.pathname]);
  const groups = visibleGroups(data?.user.isAdmin);
  // «Mais» fica destacado quando a página actual não é um dos atalhos.
  const onShortcut = MOBILE_NAV.some((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));

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
        {groups.map((g) => (
          <div key={g.title ?? 'inicio'} className="nav-group" role="group" aria-label={g.title}>
            {g.title && <p className="nav-group-title" aria-hidden="true">{g.title}</p>}
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
                <Icon name={n.icon} />{n.label}
              </NavLink>
            ))}
          </div>
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
        <main id="conteudo" className={`content${location.pathname.startsWith('/charts') ? ' content-wide' : ''}`} tabIndex={-1}>
          <Suspense fallback={<Loading rows={6} />}><Outlet /></Suspense>
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Principal">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <Icon name={n.icon} size={22} />{n.label}
          </NavLink>
        ))}
        <button type="button" data-active={!onShortcut} aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>
          <Icon name="more" size={22} />Mais
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Todos os módulos">
        <div className="more-sheet">
          {groups.map((g) => (
            <section key={g.title ?? 'inicio'} aria-label={g.title ?? 'Início'}>
              {g.title && <h3 className="nav-group-title">{g.title}</h3>}
              <div className="more-grid">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className="more-link">
                    <Icon name={n.icon} size={22} />{n.label}
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
          <button type="button" className="button button-ghost" onClick={logout} style={{ justifySelf: 'start', paddingLeft: 0 }}>
            <Icon name="logout" size={18} />Terminar sessão
          </button>
        </div>
      </Dialog>
    </div>
  );
}
