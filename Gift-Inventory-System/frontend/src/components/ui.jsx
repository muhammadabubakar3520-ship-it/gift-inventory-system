/* Small building blocks used on every page (same markup and CSS classes as the original app). */
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Analytics from '../utils/shared/analytics';
import { fmt } from '../utils/format';
import { imageUrl } from '../services/api';

/** Status pill. Transaction statuses show their business label (approved → Completed). */
export function Chip({ status, children }) {
  const label = children ?? (Analytics.STATUS[status] ? Analytics.STATUS[status] : status);
  return <span className={`chip ${status}`}>{label}</span>;
}

/** Remaining stock with low / out colouring. */
export function StockCell({ remaining, allocated }) {
  const cls = remaining <= 0 ? 'out' : allocated && remaining * 5 <= allocated ? 'low' : '';
  return <span className={`stock ${cls}`}>{fmt.n(remaining)}</span>;
}

export function EmptyState({ title = 'No records found', text = 'Try changing the filters or search.', action = null }) {
  return <div className="empty"><Icon name="inbox" /><div className="t">{title}</div><div>{text}</div>{action}</div>;
}
export function LoadingBlock({ text = 'Loading…' }) {
  return <div className="loading-block"><span className="spinner" />{text}</div>;
}
export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="empty state-error"><Icon name="alert" /><div className="t">Could not load data</div><div>{message}</div>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}</div>
  );
}

/** Page title row with description and action buttons. */
export function PageHead({ title, desc, actions }) {
  return (
    <div className="page-head">
      <div className="t"><h1>{title}</h1>{desc ? <p>{desc}</p> : null}</div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/** Search input with a debounce (300 ms by default). onChange(value) gets the trimmed text. */
export function SearchBox({ value = '', onChange, placeholder, autoFocus, delay = 300 }) {
  const [v, setV] = useState(value);
  const t = useRef(null);
  useEffect(() => { setV(value); }, [value]);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <div className="search"><Icon name="search" />
      <input className="input" type="search" value={v} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { const x = e.target.value; setV(x); clearTimeout(t.current); t.current = setTimeout(() => onChange && onChange(x.trim()), delay); }} />
    </div>
  );
}

/** <img> for protected files (proof photos, gift images): loaded with the sign-in token. */
export function AuthImage({ path, className = '', alt = '', style, onClick, ...rest }) {
  const [src, setSrc] = useState(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null); setBroken(false);
    if (path) imageUrl(path).then((u) => { if (live) setSrc(u); }, () => { if (live) setBroken(true); });
    return () => { live = false; };
  }, [path]);
  return <img className={`${className} ${src ? '' : 'loading'} ${broken ? 'broken' : ''}`.trim()} src={src || undefined} alt={broken ? 'Photo not available' : alt} style={style} onClick={onClick} {...rest} />;
}

/** Gift ratio as text (e.g. 75.0%). */
export const ratio = (r) => (r === null || r === undefined ? '—' : `${Number(r).toFixed(1)}%`);
