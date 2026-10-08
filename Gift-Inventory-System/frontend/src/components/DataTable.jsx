/* =====================================================================
   Data table (same look as the original app).
     cols: [{ key, label, num, sort, render(row, index), width, cls }]
     rows, sort, dir, onSort(key), onRow(row, event), selectable, selected (Set), onSelect(newSet),
     rowKey ('id'), footer ({ key: total }), compact, empty (element shown when there are no rows)
   ===================================================================== */
import { fmt } from '../utils/format';
import { EmptyState } from './ui';

export default function DataTable({ cols, rows, sort, dir, onSort, onRow, selectable, selected, onSelect, rowKey = 'id', footer, compact, empty, rowClass }) {
  if (!rows || !rows.length) return empty || <EmptyState />;
  const sel = selected || new Set();
  const allSel = selectable && rows.every((r) => sel.has(r[rowKey]));
  const toggleAll = (on) => { const n = new Set(sel); rows.forEach((r) => (on ? n.add(r[rowKey]) : n.delete(r[rowKey]))); onSelect && onSelect(n); };
  const toggle = (r, on) => { const n = new Set(sel); if (on) n.add(r[rowKey]); else n.delete(r[rowKey]); onSelect && onSelect(n); };
  return (
    <div className="table-wrap">
      <table className={`tbl ${compact ? 'compact' : ''}`}>
        <thead><tr>
          {selectable && <th style={{ width: 34 }}><input type="checkbox" checked={!!allSel} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all" /></th>}
          {cols.map((c, i) => (
            <th key={i} className={`${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}`.trim() || undefined} style={c.width ? { width: c.width } : undefined}
              onClick={c.sort && onSort ? () => onSort(c.sort) : undefined}>
              {c.label}{c.sort && sort === c.sort ? <span className="arrow">{dir === 'desc' ? '↓' : '↑'}</span> : null}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} className={`${onRow ? 'clickable' : ''} ${selectable && sel.has(r[rowKey]) ? 'selected' : ''} ${rowClass ? rowClass(r) || '' : ''}`.trim() || undefined}
              onClick={onRow ? (e) => { if (e.target.closest('button, a, input, label, select')) return; onRow(r, e); } : undefined}>
              {selectable && <td><input type="checkbox" checked={sel.has(r[rowKey])} onChange={(e) => toggle(r, e.target.checked)} aria-label="Select row" /></td>}
              {cols.map((c, j) => (
                <td key={j} className={`${c.num ? 'num' : ''} ${c.cls || ''}`.trim() || undefined}>
                  {c.render ? c.render(r, i) : c.num ? fmt.n(r[c.key]) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot><tr>
            {selectable && <td />}
            {cols.map((c, i) => <td key={i} className={c.num ? 'num' : undefined}>{i === 0 ? 'Total' : footer[c.key] !== undefined ? fmt.n(footer[c.key]) : ''}</td>)}
          </tr></tfoot>
        )}
      </table>
    </div>
  );
}

/** Pagination row. */
export function Pager({ page, pageSize, total, onPage, onSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager"><span>Showing <b>{fmt.n(from)}–{fmt.n(to)}</b> of <b>{fmt.n(total)}</b></span><span className="spacer" />
      <select className="select sm" style={{ width: 'auto', height: 28 }} value={pageSize} onChange={(e) => onSize(Number(e.target.value))}>
        {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
      </select>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>Page {page} of {pages}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}
