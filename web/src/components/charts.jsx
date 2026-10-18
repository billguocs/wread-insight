import React, { useEffect, useRef, useState } from 'react';

/* 测量容器宽度，让 SVG 以真实像素渲染（文字不被拉伸） */
export function useSize() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (cw) => {
      if (cw > 0) setW((prev) => (Math.abs(cw - prev) > 1 ? cw : prev));
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width;
      if (cw) apply(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* 颜色全部走 CSS 变量，切换明暗主题时图表自动跟随 */
const C = {
  axis: { fill: 'var(--ink-3)' },
  grid: { stroke: 'var(--line-2)' },
  accent: { fill: 'var(--accent)' },
  accentStrong: { fill: 'var(--accent-ink)' },
  tealLine: { stroke: 'var(--teal)' },
  hl: { fill: 'var(--hl)' },
};

function Tooltip({ x, y, children }) {
  if (x == null) return null;
  return (
    <div className="chart-tip" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

/* Catmull-Rom -> 三次贝塞尔，得到平滑折线 */
function smoothPath(pts, tension = 0.5) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** 计算「好看」的刻度步长，避免 263 / 88 这类刻度值 */
function niceScale(max, targetTicks = 4) {
  if (!max || max <= 0) return { step: 1, top: 1 };
  const raw = max / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = mult * mag;
  const top = Math.ceil(max / step) * step;
  return { step, top };
}

/* ---------------- 年度柱状图 ---------------- */
export function YearBars({ data = [], height = 236 }) {
  const [ref, w] = useSize();
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="empty">暂无年度数据</div>;

  const m = { l: 38, r: 12, t: 16, b: 30 };
  const iw = Math.max(w - m.l - m.r, 60);
  const ih = height - m.t - m.b;
  const max = Math.max(...data.map((d) => d.hours), 1);
  const { step: tickStep, top: niceMax } = niceScale(max, 4);
  const ticks = [];
  for (let v = 0; v <= niceMax + 0.001; v += tickStep) ticks.push(Math.round(v * 10) / 10);
  const bw = Math.min((iw / data.length) * 0.56, 46);
  const step = iw / data.length;

  const x = (i) => m.l + step * i + step / 2;
  const y = (v) => m.t + ih - (v / niceMax) * ih;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={m.l} x2={m.l + iw} y1={y(tv)} y2={y(tv)} strokeWidth="1" style={C.grid} />
            <text x={m.l - 8} y={y(tv) + 3.5} textAnchor="end" fontSize="9.5" style={C.axis}>
              {tv}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.hours / niceMax) * ih, d.hours > 0 ? 2 : 0);
          const active = hover === i;
          return (
            <g
              key={d.year}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'default' }}
            >
              <rect x={x(i) - step / 2} y={m.t} width={step} height={ih} fill="transparent" />
              <rect
                x={x(i) - bw / 2}
                y={m.t + ih - h}
                width={bw}
                height={h}
                rx={Math.min(4, bw / 3)}
                style={active ? C.accentStrong : C.accent}
                opacity={active ? 1 : 0.86}
              />
              <text x={x(i)} y={height - 10} textAnchor="middle" fontSize="10.5" style={C.axis}>
                {d.year}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip x={hover != null ? x(hover) : null} y={hover != null ? y(data[hover].hours) : null}>
        {hover != null ? (
          <>
            <b>{data[hover].year} 年</b>
            <br />
            {data[hover].hours} 小时 · {data[hover].days} 天
            {data[hover].booksRead ? ` · 读过 ${data[hover].booksRead} 本` : ''}
          </>
        ) : null}
      </Tooltip>
    </div>
  );
}

/* ---------------- 月度面积图 ---------------- */
export function MonthArea({ data = [], height = 210 }) {
  const [ref, w] = useSize();
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="empty">暂无月度数据</div>;

  const m = { l: 34, r: 12, t: 18, b: 26 };
  const iw = Math.max(w - m.l - m.r, 60);
  const ih = height - m.t - m.b;
  const max = Math.max(...data.map((d) => d.hours), 1);
  const niceMax = Math.max(Math.ceil(max / 10) * 10, 10);
  const step = data.length > 1 ? iw / (data.length - 1) : iw;

  const x = (i) => m.l + step * i;
  const y = (v) => m.t + ih - (v / niceMax) * ih;

  const pts = data.map((d, i) => [x(i), y(d.hours)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(data.length - 1)},${m.t + ih} L${x(0)},${m.t + ih} Z`;

  const labelEvery = Math.ceil(data.length / 8);
  const labelIdx = new Set();
  for (let i = 0; i < data.length; i += labelEvery) labelIdx.add(i);
  const lastIdx = data.length - 1;
  if (![...labelIdx].some((i) => i !== lastIdx && Math.abs(i - lastIdx) < 2)) {
    labelIdx.add(lastIdx);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg
        width={w}
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const idx = Math.round((px - m.l) / step);
          if (idx >= 0 && idx < data.length) setHover(idx);
        }}
      >
        <defs>
          <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--teal)', stopOpacity: 0.24 }} />
            <stop offset="100%" style={{ stopColor: 'var(--teal)', stopOpacity: 0.01 }} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line x1={m.l} x2={m.l + iw} y1={m.t + ih * r} y2={m.t + ih * r} style={C.grid} />
            <text x={m.l - 7} y={m.t + ih * r + 3.5} textAnchor="end" fontSize="9.5" style={C.axis}>
              {Math.round(niceMax * (1 - r))}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#areaG)" />
        <path
          d={line}
          fill="none"
          strokeWidth="1.9"
          strokeLinecap="round"
          style={C.tealLine}
        />
        {data.map((d, i) => (
          <g key={d.key}>
            {labelIdx.has(i) ? (
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="9.5" style={C.axis}>
                {d.key.slice(2)}
              </text>
            ) : null}
            {hover === i ? (
              <g>
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={m.t}
                  y2={m.t + ih}
                  style={{ stroke: 'var(--accent)' }}
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <circle
                  cx={x(i)}
                  cy={y(d.hours)}
                  r="4"
                  style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }}
                  strokeWidth="2"
                />
              </g>
            ) : null}
          </g>
        ))}
      </svg>
      <Tooltip x={hover != null ? x(hover) : null} y={hover != null ? y(data[hover].hours) : null}>
        {hover != null ? (
          <>
            <b>{data[hover].key}</b>
            <br />
            {data[hover].hours} 小时 · {data[hover].days} 天有效阅读
          </>
        ) : null}
      </Tooltip>
    </div>
  );
}

/* ---------------- 周度条形 ---------------- */
export function WeekBars({ data = [], height = 152 }) {
  const [ref, w] = useSize();
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="empty">暂无周度数据</div>;

  const m = { l: 6, r: 6, t: 16, b: 24 };
  const iw = Math.max(w - m.l - m.r, 40);
  const ih = height - m.t - m.b;
  const max = Math.max(...data.map((d) => d.hours), 1);
  const step = iw / data.length;
  const bw = Math.min(step * 0.62, 30);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} style={{ display: 'block' }}>
        {data.map((d, i) => {
          const h = Math.max((d.hours / max) * ih, d.hours > 0 ? 2 : 0);
          const cx = m.l + step * i + step / 2;
          const active = hover === i;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={m.l + step * i} y={m.t} width={step} height={ih} fill="transparent" />
              <rect
                x={cx - bw / 2}
                y={m.t + ih - h}
                width={bw}
                height={h}
                rx={3}
                style={C.hl}
                opacity={active ? 1 : 0.62}
              />
              {i % 2 === 0 || data.length <= 8 ? (
                <text x={cx} y={height - 7} textAnchor="middle" fontSize="8.5" style={C.axis}>
                  {d.key.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Tooltip
        x={hover != null ? m.l + step * hover + step / 2 : null}
        y={hover != null ? height - 60 : null}
      >
        {hover != null ? (
          <>
            周起始 {data[hover].key}
            <br />
            {data[hover].hours} 小时 · {data[hover].days} 天
          </>
        ) : null}
      </Tooltip>
    </div>
  );
}

/* ---------------- 24 小时阅读时钟 ---------------- */
export function DayClock({ data = [], label = '', size = 250 }) {
  const [hover, setHover] = useState(null);
  if (!data.length) return <div className="empty">暂无时段数据</div>;

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 20;
  const rInner = rOuter * 0.42;
  const max = Math.max(...data.map((d) => d.seconds), 1);
  const total = data.reduce((s, d) => s + d.seconds, 0);

  const arc = (i, ratio) => {
    const a0 = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / 24) * Math.PI * 2 - Math.PI / 2;
    const pad = 0.012;
    const r = rInner + (rOuter - rInner) * ratio;
    const x0 = cx + Math.cos(a0 + pad) * rInner;
    const y0 = cy + Math.sin(a0 + pad) * rInner;
    const x1 = cx + Math.cos(a0 + pad) * r;
    const y1 = cy + Math.sin(a0 + pad) * r;
    const x2 = cx + Math.cos(a1 - pad) * r;
    const y2 = cy + Math.sin(a1 - pad) * r;
    const x3 = cx + Math.cos(a1 - pad) * rInner;
    const y3 = cy + Math.sin(a1 - pad) * rInner;
    return `M${x0},${y0} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 0 0 ${x0},${y0} Z`;
  };

  const peak = data.reduce((a, b) => (b.seconds > a.seconds ? b : a), data[0]);

  return (
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <svg
        width={size}
        height={size}
        style={{ overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <circle
          cx={cx}
          cy={cy}
          r={rOuter + 6}
          fill="none"
          strokeWidth="1"
          style={{ stroke: 'var(--line-2)' }}
        />
        {data.map((d, i) => {
          const ratio = d.seconds / max;
          const active = hover === i;
          return (
            <path
              key={d.hour}
              d={arc(i, Math.max(ratio, 0.012))}
              onMouseEnter={() => setHover(i)}
              style={{
                fill: active ? 'var(--accent)' : 'var(--teal)',
                fillOpacity: active ? 1 : 0.16 + ratio * 0.74,
                transition: 'fill .15s',
                cursor: 'default',
              }}
            />
          );
        })}
        {[0, 6, 18].map((h) => {
          // 12 点方位留给底部文案，避免标签重叠
          const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
          const r = rOuter + 13;
          return (
            <text
              key={h}
              x={cx + Math.cos(a) * r}
              y={cy + Math.sin(a) * r + 3}
              textAnchor="middle"
              fontSize="9.5"
              style={C.axis}
            >
              {h}时
            </text>
          );
        })}
        <text x={cx} y={cy - 11} textAnchor="middle" fontSize="10" style={C.axis}>
          峰值时段
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="16"
          fontFamily="var(--serif)"
          fontWeight="600"
          style={{ fill: 'var(--ink)' }}
        >
          {peak.hour}–{peak.hour + 1} 时
        </text>
      </svg>
      {hover != null ? (
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 11,
            color: 'var(--ink-2)',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            padding: '3px 10px',
            borderRadius: 20,
            whiteSpace: 'nowrap',
          }}
        >
          {data[hover].hour}:00 – {data[hover].hour + 1}:00 ·{' '}
          {total ? ((data[hover].seconds / total) * 100).toFixed(1) : 0}%
        </div>
      ) : label ? (
        <div
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 11.5,
            color: 'var(--teal)',
            background: 'var(--teal-soft)',
            padding: '3px 11px',
            borderRadius: 20,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- 环形进度 ---------------- */
export function ProgressRing({ value = 0, size = 62, stroke = 5, label, color }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: 'var(--surface-3)' }}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            stroke: color || 'var(--accent)',
            transition: 'stroke-dasharray .6s ease',
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: 11.5,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink)',
        }}
      >
        {label ?? `${Math.round(pct)}%`}
      </div>
    </div>
  );
}

/* ---------------- 月度热力格 ---------------- */
export function MonthHeat({ data = [] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.hours), 1);
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {data.map((d) => {
          const ratio = d.hours / max;
          return (
            <div
              key={d.key}
              title={`${d.key} · ${d.hours} 小时`}
              style={{
                width: 26,
                height: 26,
                borderRadius: 5,
                background:
                  ratio === 0
                    ? 'var(--surface-3)'
                    : `color-mix(in srgb, var(--accent) ${Math.round(12 + ratio * 78)}%, transparent)`,
                display: 'grid',
                placeItems: 'center',
                fontSize: 8.5,
                color: ratio > 0.55 ? '#fff' : 'var(--ink-3)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {d.key.slice(5)}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          marginTop: 10,
          fontSize: 10.5,
          color: 'var(--ink-3)',
        }}
      >
        少
        {[0.08, 0.28, 0.5, 0.72, 0.95].map((a) => (
          <span
            key={a}
            style={{
              width: 11,
              height: 11,
              borderRadius: 3,
              background: `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, transparent)`,
            }}
          />
        ))}
        多
      </div>
    </div>
  );
}