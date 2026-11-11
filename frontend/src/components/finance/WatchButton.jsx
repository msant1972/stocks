import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/controls.jsx';

/**
 * Botão de ícone para pôr ou tirar um instrumento de «A minha lista» (WinnersLoosers, Pechinchas): «+» adiciona, o caixote do
 * lixo (vermelho) remove; nome acessível com o símbolo. row: { symbol }; inWatchlist: está na lista.
 */
export default function WatchButton({ row, inWatchlist, busy, onToggle }) {
  const label = inWatchlist ? `Remover ${row.symbol} da minha lista` : `Adicionar ${row.symbol} à minha lista`;
  return (
    <Button size="small" variant="ghost" className={`icon-button wl-watch${inWatchlist ? ' in' : ''}`} busy={busy}
      onClick={() => onToggle(row)} title={inWatchlist ? 'Na minha lista: remover' : 'Adicionar à minha lista'} aria-pressed={inWatchlist}>
      <Icon name={inWatchlist ? 'trash' : 'plus'} size={18} />
      <span className="visually-hidden">{label}</span>
    </Button>
  );
}
