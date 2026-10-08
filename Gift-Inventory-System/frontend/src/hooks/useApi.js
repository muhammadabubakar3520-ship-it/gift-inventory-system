/* =====================================================================
   Load data from the API for a page.
     const { data, error, loading, reload, setData } = useApi(() => api('/gifts/' + id), [id]);
   - first load shows `loading`; later reloads keep the old data on screen
   - reloads automatically when another device saves a change (live sync)
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '../context/SyncContext';

export default function useApi(fn, deps = [], { live = true } = {}) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fnRef.current();
      if (my === seq.current) { setData(d); setError(null); }
      return d;
    } catch (e) {
      if (my === seq.current) setError(e);
      return undefined;
    } finally { if (my === seq.current) setLoading(false); }
  }, []);
  useEffect(() => { setLoading(true); setData(undefined); setError(null); reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(() => (live ? reload() : undefined));
  return { data, error, loading, reload, setData };
}
