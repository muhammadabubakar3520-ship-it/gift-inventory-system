/* DOS (Days of Stock) cells shared by several pages (from pages-dos.js: Admin.dosChip, Admin.dosNum, dosBar). */
import { fmt } from '../../utils/format';

/** DOS status pill. */
export const dosChip = (r) => <span className={`chip dos-${r.status}`}>{r.status_label}</span>;

/** DOS number in days ("—" when nothing was sold). */
export const dosNum = (r) => (r.dos === null ? <span className="muted">—</span> : <b>{fmt.n(r.dos)}</b>);

/** Small horizontal bar: 0–60 days scale, coloured by status. */
export const dosBar = (r) => {
  const w = r.status === 'out' ? 0 : r.dos === null ? 100 : Math.min(100, (r.dos / 60) * 100);
  return <span className={`dos-bar dos-${r.status}`}><i style={{ width: `${w}%` }} /></span>;
};
