import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useRealtime } from '../context/RealtimeContext.jsx';

/**
 * GET `path` and keep it fresh. `live` lists Socket.IO events that trigger a silent refetch,
 * so stock figures update on every screen as soon as anybody changes them.
 */
export default function useFetch(path, { live = [], skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const { subscribe } = useRealtime();
  const seq = useRef(0);
  const liveKey = live.join('|');

  const load = useCallback(async (silent = false) => {
    if (skip || !path) return;
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await api.get(path);
      if (my === seq.current) { setData(r); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path, skip]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!live.length) return undefined;
    let timer;
    const trigger = () => { clearTimeout(timer); timer = setTimeout(() => load(true), 350); };
    const offs = live.map((e) => subscribe(e, trigger));
    return () => { clearTimeout(timer); offs.forEach((off) => off()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, load, subscribe]);

  return { data, error, loading, reload: () => load(false), setData };
}
