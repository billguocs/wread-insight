import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** 通用数据获取：loading / error / data + 手动重载 */
export function useApi(fetcher, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (skip) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, loading: true, error: null }));
    Promise.resolve()
      .then(() => fetcherRef.current({ signal: ctrl.signal }))
      .then((data) => {
        if (mounted.current && !ctrl.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return;
        if (mounted.current) setState({ data: null, loading: false, error: err });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, skip]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: d })) };
}

/** 轮询同步状态，运行中每 1.5s 刷新一次。resetKey 变化（如切换档案）时重新开始轮询 */
export function useSyncWatcher(onDone, resetKey) {
  const [status, setStatus] = useState({ status: 'idle' });
  const [meta, setMeta] = useState(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const refreshMeta = useCallback(async () => {
    try {
      const m = await api.meta();
      setMeta(m);
      return m;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let timer = null;
    let alive = true;
    let wasRunning = false;

    const poll = async () => {
      try {
        const s = await api.syncStatus();
        if (!alive) return;
        setStatus(s);
        if (s.status === 'running') {
          wasRunning = true;
          timer = setTimeout(poll, 1500);
        } else {
          if (wasRunning) {
            wasRunning = false;
            await refreshMeta();
            doneRef.current?.(s);
          }
        }
      } catch {
        if (alive) timer = setTimeout(poll, 4000);
      }
    };

    refreshMeta();
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMeta, resetKey]);

  const trigger = useCallback(async (mode = 'quick') => {
    const r = await api.triggerSync(mode);
    setStatus(r?.status || { status: 'running', mode, step: '启动中', done: 0, total: 0 });
  }, []);

  return { status, meta, trigger, refreshMeta };
}

export function useToast() {
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  const show = useCallback((m, ms = 2200) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), ms);
  }, []);
  useEffect(() => () => timer.current && clearTimeout(timer.current), []);
  return { msg, show };
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}