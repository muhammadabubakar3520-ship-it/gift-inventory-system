/* Lists used by many admin screens (filters, dropdowns): cities, markets, promoters, gifts, models,
   brands and (on demand) shops. Reloaded after changes and when another device saves data. */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useLiveRefresh } from './SyncContext';

const LookupsContext = createContext(null);
/** For code outside React components (event helpers): lookups.loadLookups() / lookups.allShops(). */
export const lookups = { loadLookups: async () => null, allShops: async () => null, current: () => null };
const EMPTY = { cities: [], markets: [], promoters: [], gifts: [], brands: [], models: [], shops: null };

export function LookupsProvider({ children }) {
  const [lk, setLk] = useState(EMPTY);
  const ref = useRef(EMPTY);
  const put = (patch) => { ref.current = { ...ref.current, ...patch }; setLk(ref.current); return ref.current; };

  const loadLookups = useCallback(async () => {
    const [cities, markets, promoters, gifts, models, brands] = await Promise.all([
      api('/masters/cities', { quiet: true }), api('/masters/markets', { quiet: true }),
      api('/users', { query: { role: 'promoter' }, quiet: true }), api('/gifts', { quiet: true }), api('/models', { quiet: true }), api('/brands', { quiet: true }),
    ]);
    return put({ cities, markets, promoters, gifts, models, brands });
  }, []);
  /** All shops (for filter dropdowns). Cached; force = reload. */
  const allShops = useCallback(async (force) => {
    if (!ref.current.shops || force) put({ shops: (await api('/shops', { query: { all: '1' }, quiet: true })).rows });
    return ref.current.shops;
  }, []);

  lookups.loadLookups = loadLookups; lookups.allShops = allShops; lookups.current = () => ref.current;
  useLiveRefresh(async () => { if (ref.current.cities.length || ref.current.gifts.length) { await loadLookups(); if (ref.current.shops) await allShops(true); } }, { always: true });

  const value = useMemo(() => ({ lk, lkRef: ref, loadLookups, allShops }), [lk, loadLookups, allShops]);
  return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>;
}

export const useLookups = () => useContext(LookupsContext);
