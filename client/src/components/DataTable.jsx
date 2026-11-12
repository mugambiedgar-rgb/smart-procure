import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Empty, Spinner } from './ui.jsx';

/**
 * Searchable, sortable, paginated table.
 * columns: [{ key, label, render?(row), sortValue?(row), align?, className?, searchable? }]
 */
export default function DataTable({ columns, rows = [], loading, pageSize = 10, searchPlaceholder = 'Search...', filters, toolbar, onRowClick, emptyText = 'No records found', rowKey = 'id', rowClass, searchable = true, initialSearch = '' }) {
  const [q, setQ] = useState(initialSearch);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [size, setSize] = useState(pageSize);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    const keys = columns.filter((c) => c.searchable !== false).map((c) => c.key);
    return rows.filter((r) => keys.some((k) => { const v = r[k]; return v !== null && v !== undefined && String(v).toLowerCase().includes(term); }));
  }, [rows, q, columns]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const get = (r) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
    const arr = [...filtered].sort((a, b) => {
      const x = get(a); const y = get(b);
      if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x).localeCompare(String(y), undefined, { numeric: true });
    });
    return sort.dir === 'desc' ? arr.reverse() : arr;
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  useEffect(() => { setPage(1); }, [q, rows.length, size]);
  const cur = Math.min(page, pages);
  const slice = sorted.slice((cur - 1) * size, cur * size);

  const toggleSort = (c) => { if (c.sortable === false) return; setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })); };

  return (
    <div className="table-wrap">
      {(searchable || filters || toolbar) && (
        <div className="table-toolbar">
          {searchable && (
            <div className="search-box"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="Search table" /></div>
          )}
          {filters}
          <div className="grow" />
          {toolbar}
        </div>
      )}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`${c.align === 'right' ? 'right' : ''} ${c.sortable === false ? '' : 'sortable'}`} onClick={() => toggleSort(c)} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <span>{c.label}{sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr><td colSpan={columns.length}><Spinner block /></td></tr>
            ) : slice.length === 0 ? (
              <tr><td colSpan={columns.length}><Empty title={emptyText} /></td></tr>
            ) : slice.map((r, i) => (
              <tr key={r[rowKey] ?? i} className={`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={`${c.align === 'right' ? 'right' : ''} ${c.className || ''}`}>{c.render ? c.render(r) : (r[c.key] ?? '-')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span className="muted small">{sorted.length === 0 ? '0 records' : `${(cur - 1) * size + 1}-${Math.min(cur * size, sorted.length)} of ${sorted.length}`}</span>
        <div className="pager">
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
          <button className="icon-btn" disabled={cur <= 1} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <span className="small">{cur} / {pages}</span>
          <button className="icon-btn" disabled={cur >= pages} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
