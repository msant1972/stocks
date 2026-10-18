import { useEffect, useState } from 'react';

const KEY = 'stocks.theme';
const TRANSPARENCY_KEY = 'stocks.transparency';

function read(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* armazenamento indisponível: fica só nesta sessão */ }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function apply(pref) {
  const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// Com «Sistema», acompanha a mudança de tema do sistema operativo em tempo real.
darkQuery.addEventListener('change', () => apply(read(KEY, 'system')));

/** Tema 'light' | 'dark' | 'system'. O tema inicial é aplicado em index.html, antes do primeiro desenho. */
export function useTheme() {
  const [pref, setPref] = useState(() => read(KEY, 'system'));
  return [pref, (value) => { write(KEY, value); apply(value); setPref(value); }];
}

export function useReducedTransparency() {
  const [on, setOn] = useState(() => read(TRANSPARENCY_KEY, '') === 'reduced');
  useEffect(() => {
    if (on) document.documentElement.dataset.transparency = 'reduced';
    else delete document.documentElement.dataset.transparency;
  }, [on]);
  return [on, (value) => { write(TRANSPARENCY_KEY, value ? 'reduced' : ''); setOn(value); }];
}
