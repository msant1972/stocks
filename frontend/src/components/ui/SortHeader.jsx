/**
 * Próxima ordenação ao clicar num cabeçalho: a mesma coluna inverte, outra começa no sentido habitual
 * (defaults: { chave: 'asc' | 'desc' }).
 */
export const nextSort = (sort, key, defaults) => (sort.key === key
  ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
  : { key, dir: defaults[key] ?? 'desc' });

/** Cabeçalho de tabela ordenável: botão com seta e aria-sort. onSort recebe a chave da coluna. */
export default function SortHeader({ label, sortKey, sort, onSort, align, title }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" className={align === 'r' ? 'r' : undefined} aria-sort={ariaSort} title={title}>
      <button type="button" className={`sort-button${active ? ' active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="sort-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
