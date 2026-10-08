/* =====================================================================
   Server-paginated / filtered list (replaces Admin.Paged).
     const list = usePaged({ initial: { search: '', status: '' }, fetch: (st) => api('/shops', { query: st }) });
     list.state            current filters + page + pageSize (+ sort/dir)
     list.set(patch, keepPage)   change filters (goes back to page 1 unless keepPage)
     list.sortBy(key)      toggle sorting
     list.data / list.error / list.loading / list.reload()
   Render with <PagedView list={list}>{(data, state) => <DataTable … />}</PagedView>.
   Lists reload by themselves when another device saves a change (filters are kept).
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '../context/SyncContext';
import { LoadingBlock, ErrorBlock } from '../components/ui';
import { Pager } from '../components/DataTable';

export default function usePaged({ initial = {}, fetch, pageSize = 25, auto = true }) {
  const [state, setState] = useState({ page: 1, pageSize, ...initial });
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const stRef = useRef(state);
  stRef.current = state;
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const load = useCallback(async (st = stRef.current) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fetchRef.current(st);
      if (my === seq.current) { setData(d); setError(null); }
      return d;
    } catch (e) {
      if (my === seq.current) setError(e);
      return undefined;
    } finally { if (my === seq.current) setLoading(false); }
  }, []);

  const set = useCallback((patch, keepPage) => {
    setState((s) => { const n = { ...s, ...patch }; if (!keepPage) n.page = 1; return n; });
  }, []);
  const sortBy = useCallback((key) => {
    setState((s) => ({ ...s, sort: key, dir: s.sort === key && s.dir !== 'desc' ? 'desc' : 'asc' }));
  }, []);
  const first = useRef(true);
  useEffect(() => { if (auto || !first.current) load(state); first.current = false; }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(() => load());

  return { state, set, sortBy, data, error, loading, reload: () => load(), setData };
}

/** Loading / error / content + pager for a usePaged list. */
export function PagedView({ list, children, pager = true }) {
  const { data, error, loading, state } = list;
  if (data === undefined && !error) return <LoadingBlock />;
  if (error && data === undefined) return <ErrorBlock message={error.message} onRetry={list.reload} />;
  return (
    <div style={loading ? { opacity: 0.55 } : undefined}>
      {children(data, state)}
      {pager && data && data.total !== undefined && (
        <Pager page={state.page} pageSize={state.pageSize} total={data.total}
          onPage={(p) => list.set({ page: p }, true)} onSize={(s) => list.set({ pageSize: s })} />
      )}
    </div>
  );
}
