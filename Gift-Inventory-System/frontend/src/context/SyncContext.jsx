/* =====================================================================
   Live sync between devices.
   MongoDB (through the API) is the only source of truth. When any device saves a change, the
   server sends a Socket.IO event "data:changed". This screen then reloads what it shows from the
   API. If the live connection is not available, the screen checks /api/sync every 20 seconds.

   Pages register reload functions with useLiveRefresh(fn). Pages where the user is in the middle
   of a task (Excel import, allocation, …) call useHoldLive(): they get a "Refresh" banner instead
   of an automatic reload. Open forms / modals are never reloaded under the user's hands.
   ===================================================================== */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api, API_ORIGIN, CLIENT_ID, session } from '../services/api';
import { useAuth } from './AuthContext';

const SyncContext = createContext(null);

export function SyncProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState('connecting'); // 'live' | 'polling' | 'connecting'
  const [waiting, setWaiting] = useState(false); // a change arrived but the page cannot reload now
  const [reloadKey, setReloadKey] = useState(0); // remounts the current page (banner "Refresh")
  const refreshers = useRef(new Set());
  const always = useRef(new Set()); // e.g. lookups: always reloaded
  const held = useRef(0);
  const dirty = useRef(false);
  const version = useRef(null);
  const timer = useRef(null);
  const loc = useLocation();

  useEffect(() => { dirty.current = false; setWaiting(false); }, [loc.pathname, loc.search, reloadKey]);
  useEffect(() => {
    // typing in a form on the page (not in a modal: open modals are checked separately) holds live reloads
    const onInput = (e) => { if (e.target.closest && e.target.closest('.content form, .pm-main form')) dirty.current = true; };
    document.addEventListener('input', onInput, true);
    return () => document.removeEventListener('input', onInput, true);
  }, []);

  const canRefreshNow = useCallback(() => {
    if (held.current > 0 || dirty.current || document.querySelector('.modal-backdrop') || document.querySelector('.scanner')) return false;
    const a = document.activeElement;
    if (a && a.closest && a.closest('.content, .pm-main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['search', 'checkbox', 'radio'].includes(a.type)) return false;
    return true;
  }, []);

  const apply = useCallback(async () => {
    for (const fn of [...always.current]) { try { await fn(); } catch (_) { /* ignore */ } }
    if (!canRefreshNow()) { setWaiting(true); return; }
    setWaiting(false);
    const list = [...refreshers.current];
    if (list.length) { for (const fn of list) { try { await fn(); } catch (_) { /* the page shows its own error */ } } } else setReloadKey((k) => k + 1);
  }, [canRefreshNow]);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const seen = useCallback((v, client) => {
    const changed = version.current !== null && v !== version.current;
    version.current = v;
    if (changed && client !== CLIENT_ID) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => applyRef.current(), 600); // several saves close together = one refresh
    }
  }, []);

  // retry a held refresh when the page becomes free
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => { if (canRefreshNow()) applyRef.current(); }, 3000);
    return () => clearInterval(t);
  }, [waiting, canRefreshNow]);

  // Socket.IO connection + polling fallback while signed in
  useEffect(() => {
    if (!user || !session.token()) return undefined;
    let poll = null;
    const check = async () => {
      try { const r = await api('/sync', { quiet: true }); seen(r.version, null); } catch (_) { /* offline: next time */ }
    };
    const startPolling = () => { if (!poll) poll = setInterval(check, 20000); };
    const stopPolling = () => { clearInterval(poll); poll = null; };
    const socket = io(API_ORIGIN, { path: '/socket.io', auth: { token: session.token() }, reconnectionDelayMax: 30000 });
    socket.on('connect', () => { setState('live'); stopPolling(); check(); });
    socket.on('disconnect', () => { setState('polling'); startPolling(); });
    socket.on('connect_error', () => { setState('polling'); startPolling(); });
    socket.on('hello', (m) => seen(m.v, null));
    socket.on('data:changed', (m) => seen(m.v, m.client));
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', check);
    startPolling();
    return () => {
      socket.close(); stopPolling();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', check);
      version.current = null;
    };
  }, [user, seen]);

  const value = useMemo(() => ({
    state, waiting, reloadKey,
    reloadPage: () => setReloadKey((k) => k + 1),
    register: (fn, opts = {}) => { const set = opts.always ? always.current : refreshers.current; set.add(fn); return () => set.delete(fn); },
    hold: () => { held.current++; return () => { held.current--; }; },
  }), [state, waiting, reloadKey]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export const useSync = () => useContext(SyncContext);

/** Reload this data when another device saves a change. */
export function useLiveRefresh(fn, opts) {
  const sync = useSync();
  const ref = useRef(fn);
  ref.current = fn;
  const register = sync && sync.register;
  useEffect(() => (register ? register(() => ref.current && ref.current(), opts) : undefined), [register]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** This page holds live reloads (shows a Refresh banner instead). */
export function useHoldLive(on = true) {
  const sync = useSync();
  const hold = sync && sync.hold;
  useEffect(() => (on && hold ? hold() : undefined), [on, hold]);
}
