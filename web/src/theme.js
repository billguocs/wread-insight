import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'xd.theme'; // auto | light | dark

/**
 * 主题：默认跟随系统，可手动切到浅色/深色。
 * auto 时移除 data-theme，完全交给 prefers-color-scheme；手动时用属性强制覆盖。
 */
export function useTheme() {
  const [mode, setModeState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const setMode = useCallback((m) => setModeState(m), []);
  const cycle = useCallback(
    () => setModeState((m) => (m === 'auto' ? 'light' : m === 'light' ? 'dark' : 'auto')),
    []
  );

  const effective = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;
  return { mode, effective, systemDark, setMode, cycle };
}

/** 供 SVG 图表读取当前配色（随主题切换自动重绘） */
export function useChartColors() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );

  useEffect(() => {
    const read = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setDark(attr === 'dark' || (attr !== 'light' && sysDark));
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', read);
      mo.disconnect();
    };
  }, []);

  return dark;
}