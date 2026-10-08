/* Sortable report table for a { columns, rows, totals } report (from pages-reports.js: Admin.reportTable). */
import { EmptyState } from '../ui';
import { fmt } from '../../utils/format';

const cellVal = (c, r) => {
  const v = r[c.key];
  if (c.date) return v ? fmt.dt(v) : '—';
  if (c.num) {
    if (v === null || v === undefined || v === '') return '—';
    if (c.pct || /rate|utilisation/.test(c.key)) return fmt.pct(v);
    return c.dec ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }) : fmt.n(v);
  }
  return v === null || v === undefined || v === '' ? '—' : v;
};
const totVal = (c, v) => (v === undefined || v === null ? '' : c.pct ? fmt.pct(v) : fmt.n(v));
const MONO = /(^|_)(shop_id|user_code|gift_id|brand_code|item_code|transaction_id)$/;

/**
 * Legacy Admin.reportTable(d, sort).
 *   data: { columns, rows, totals }   sort: { key, dir } | null   onSort(key): header clicked
 */
export default function ReportTable({ data: d, sort, onSort }) {
  if (!d.rows.length) return <EmptyState title="No data for this report" text="Try a wider date range or fewer filters." />;
  let rows = d.rows;
  if (sort && sort.key) {
    const c = d.columns.find((x) => x.key === sort.key);
    rows = [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = c && c.num ? (Number(x) || 0) - (Number(y) || 0) : String(x ?? '').localeCompare(String(y ?? ''));
      return sort.dir === 'desc' ? -r : r;
    });
  }
  const hasTotals = d.totals && Object.keys(d.totals).length;
  const shown = rows.slice(0, 2000);
  return (
    <>
      <div className="table-wrap" style={{ maxHeight: '68vh' }}><table className="tbl">
        <thead><tr>{d.columns.map((c) => (
          <th key={c.key} className={`${c.num ? 'num' : ''} sortable`} onClick={() => onSort && onSort(c.key)}>
            {c.label}{sort && sort.key === c.key ? <span className="arrow">{sort.dir === 'desc' ? '↓' : '↑'}</span> : null}
          </th>
        ))}</tr></thead>
        <tbody>{shown.map((r, ri) => (
          <tr key={ri}>{d.columns.map((c, i) => (
            <td key={c.key} className={`${c.num ? 'num' : ''} ${i === 0 ? 'nowrap' : ''}`}>
              {MONO.test(c.key) ? <span className="mono">{cellVal(c, r)}</span> : cellVal(c, r)}
            </td>
          ))}</tr>
        ))}</tbody>
        {hasTotals ? <tfoot><tr>{d.columns.map((c, i) => (
          <td key={c.key} className={c.num ? 'num' : ''}>{i === 0 ? `Total (${fmt.n(rows.length)} rows)` : totVal(c, d.totals[c.key])}</td>
        ))}</tr></tfoot> : null}
      </table></div>
      {rows.length > shown.length ? <p className="muted small" style={{ padding: '8px 16px' }}>Showing 2,000 of {fmt.n(rows.length)} rows. Excel / CSV exports include all rows.</p> : null}
    </>
  );
}
