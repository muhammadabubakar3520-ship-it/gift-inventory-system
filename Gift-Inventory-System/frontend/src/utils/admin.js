/* Helpers shared by the admin screens (date ranges, filter text, query cleaning, chart colours). */
import { fmt } from './format';

/** Date-range buttons used by sales pages and reports. */
export const RANGES = [['mtd', 'This month'], ['30', '30 days'], ['90', '90 days'], ['ytd', 'This year'], ['all', 'All time']];
export function rangeDates(r) {
  if (r === 'all') return { from: '', to: '' };
  if (r === 'mtd') return { from: fmt.monthStart(), to: fmt.today() };
  if (r === 'ytd') return { from: `${new Date().getFullYear()}-01-01`, to: fmt.today() };
  if (r === 'today') return { from: fmt.today(), to: fmt.today() };
  return { from: fmt.daysAgo(Number(r) - 1), to: fmt.today() };
}
export const ratio = (r) => (r === null || r === undefined ? '—' : `${Number(r).toFixed(1)}%`);

/** Query object without empty values. */
export const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));

/** Human text for the active filters (report subtitles, Excel headers). lk = lookups. */
export function filterText(st, lk) {
  const parts = [];
  if (st.from || st.to) parts.push(`Period: ${st.from || 'start'} to ${st.to || 'today'}`); else parts.push('Period: all time');
  const name = (list, id, f) => { const x = (list || []).find((y) => String(y.id) === String(id)); return x ? f(x) : null; };
  const add = (label, v) => { if (v) parts.push(`${label}: ${v}`); };
  add('City', name(lk.cities, st.city_id, (x) => x.city_name)); add('Market', name(lk.markets, st.market_id, (x) => x.market_name));
  add('Promoter', name(lk.promoters, st.promoter_id, (x) => x.name)); add('Shop', name(lk.shops, st.shop_id, (x) => `${x.shop_name} (${x.shop_id})`));
  add('Brand', name(lk.brands, st.brand_id, (x) => x.brand_name)); add('Model', name(lk.models, st.model_id, (x) => x.model_name)); add('Gift', name(lk.gifts, st.gift_id, (x) => x.gift_name));
  return parts.join(' · ');
}

export const PALETTE = ['#1f4fd1', '#0f8a5f', '#d98a00', '#7a4fd1', '#c62f3c', '#1f9bb2', '#6b7a90', '#b84f9a', '#4f8f1f', '#8a6b3c', '#2f6f6f', '#a33f1f'];

/**
 * Hand-over between screens that the original kept on window.Admin:
 * Gift DOS → "Allocate refill" puts lines here, Allocate Gifts picks them up.
 */
export const pendingAllocation = { lines: null, note: null };
