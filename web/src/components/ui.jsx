import React, { useEffect, useState } from 'react';

/* ---------------- 图标 ---------------- */
const paths = {
  shelf: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H9v18H5.5A1.5 1.5 0 0 1 4 19.5v-15Z" />
      <path d="M9 3h4.5A1.5 1.5 0 0 1 15 4.5v15a1.5 1.5 0 0 1-1.5 1.5H9V3Z" />
      <path d="m16.4 4.2 3.1.8a1.5 1.5 0 0 1 1.05 1.85l-3.6 14.1-3.95-1" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M8 13h7M8 17h5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  download: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V5Z" />
      <path d="M4 19a2 2 0 0 1 2-2h13" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6.3 6.3 2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
    </>
  ),
  moon: <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.6 8.6 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export function Icon({ name, size = 16, className = '', strokeWidth = 1.7 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name] || null}
    </svg>
  );
}

/* ---------------- 基础件 ---------------- */
export function Card({ children, className = '', style }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardHead({ title, hint, children }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {hint ? <span className="hint">{hint}</span> : null}
      {children}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, style }) {
  return <div className="sk" style={{ width: w, height: h, ...style }} />;
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card">
      <Skeleton w="42%" h={16} style={{ marginBottom: 16 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={12} style={{ marginBottom: 9, width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}

export function Empty({ text = '暂无数据', hint }) {
  return (
    <div className="empty">
      <div className="em-icon">◌</div>
      <div>{text}</div>
      {hint ? <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.75 }}>{hint}</div> : null}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div
      className="card"
      style={{
        borderColor: 'color-mix(in srgb, #d4574b 35%, var(--line))',
        background: 'color-mix(in srgb, #d4574b 8%, var(--surface))',
        color: 'color-mix(in srgb, #d4574b 78%, var(--ink))',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ flex: 1 }}>{error.message || '加载失败'}</span>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

/* 封面：加载失败或缺失时回退到排版书名 */
export function BookCover({ src, title, className = 'book-cover', badge, progress }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={className}>
      {src && !failed ? (
        <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="ph">{title}</div>
      )}
      {badge}
      {typeof progress === 'number' && progress > 0 ? (
        <div className="prog">
          <i style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function Stars({ value }) {
  if (!value) return null;
  const full = Math.round(value / 2);
  return (
    <span className="stars" title={`豆瓣 ${value}`}>
      {'★'.repeat(Math.max(0, Math.min(5, full)))}
      {'☆'.repeat(Math.max(0, 5 - full))}
    </span>
  );
}

export function Rating({ label, value, sub }) {
  return (
    <div className="rating-item">
      <span className="rl">{label}</span>
      <span className="rn" style={{ color: value == null ? 'var(--ink-4)' : undefined }}>
        {value == null ? '—' : Number(value).toFixed(1)}
      </span>
      {sub ? <span className="rv">{sub}</span> : null}
    </div>
  );
}

/* ---------------- 弹层 ---------------- */
export function Modal({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={15} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ---------------- 数字格式 ---------------- */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, '0')} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${s} 秒`;
}

export function fmtHours(seconds) {
  const h = Number(seconds || 0) / 3600;
  if (h >= 100) return `${Math.round(h)}`;
  if (h >= 10) return h.toFixed(1);
  return h.toFixed(1);
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1)} 万`;
  return v.toLocaleString('zh-CN');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relTime(iso) {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmtDate(iso).slice(0, 10);
}

export function Highlight({ text, keyword }) {
  if (!keyword) return <>{text}</>;
  const t = String(text || '');
  const k = keyword.trim();
  if (!k) return <>{t}</>;
  const idx = t.toLowerCase().indexOf(k.toLowerCase());
  if (idx < 0) return <>{t}</>;
  return (
    <>
      {t.slice(0, idx)}
      <mark>{t.slice(idx, idx + k.length)}</mark>
      {t.slice(idx + k.length)}
    </>
  );
}