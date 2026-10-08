/* <option> lists for the admin dropdowns (lk = lookups from useLookups()). */
export function opts(list, { value = 'id', label, placeholder, filter } = {}) {
  const items = filter ? (list || []).filter(filter) : (list || []);
  return [
    placeholder !== undefined ? <option key="__ph" value="">{placeholder}</option> : null,
    ...items.map((x) => <option key={x[value]} value={x[value]}>{label ? label(x) : x.name}</option>),
  ];
}
export const cityOpts = (lk, ph = 'All cities') => opts(lk.cities, { label: (c) => c.city_name, placeholder: ph });
export const marketOpts = (lk, cityId, ph = 'All markets') => opts(lk.markets, {
  label: (m) => (cityId ? m.market_name : `${m.market_name} (${m.city_name})`), placeholder: ph,
  filter: cityId ? (m) => String(m.city_id) === String(cityId) : null,
});
/** activeOnly: hide inactive promoters except the selected one (sel). */
export const promoterOpts = (lk, ph = 'All promoters', activeOnly = false, sel) => opts(lk.promoters, {
  label: (p) => `${p.name}${p.status !== 'active' ? ' (inactive)' : ''}`, placeholder: ph,
  filter: activeOnly ? (p) => p.status === 'active' || String(p.id) === String(sel ?? '') : null,
});
export const brandOpts = (lk, ph = 'All brands', activeOnly = false, sel) => opts(lk.brands, {
  label: (b) => `${b.brand_name}${b.status !== 'active' ? ' (inactive)' : ''}`, placeholder: ph,
  filter: activeOnly ? (b) => b.status === 'active' || String(b.id) === String(sel ?? '') : null,
});
export const modelOpts = (lk, ph = 'All models', brandId) => opts(lk.models, {
  label: (m) => `${brandId ? '' : (m.brand_name ? m.brand_name + ' ' : '')}${m.model_name} (${m.item_code})`, placeholder: ph,
  filter: brandId ? (m) => String(m.brand_id) === String(brandId) : null,
});
export const shopOpts = (shops, ph = 'All shops') => opts(shops || [], { label: (s) => `${s.shop_name} (${s.shop_id})`, placeholder: ph });
export const giftOpts = (lk, ph = 'All gifts', activeOnly = false) => opts(lk.gifts, {
  label: (g) => `${g.gift_name}${g.status !== 'active' ? ' (inactive)' : ''}`, placeholder: ph,
  filter: activeOnly ? (g) => g.status === 'active' : null,
});
