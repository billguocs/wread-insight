import React from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { DayClock, MonthArea, MonthHeat, WeekBars, YearBars } from '../components/charts.jsx';
import {
  BookCover,
  Card,
  CardHead,
  Empty,
  ErrorBox,
  Skeleton,
  SkeletonCard,
  fmtDate,
  fmtDuration,
  fmtNum,
} from '../components/ui.jsx';

function Kpi({ label, value, unit, foot, accent }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ color: accent }}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

export default function Analytics({ meta }) {
  const ov = useApi(() => api.overview(), []);
  const tr = useApi(() => api.trend(), []);
  const pf = useApi(() => api.profile(), []);

  if (ov.error) return <ErrorBox error={ov.error} onRetry={ov.reload} />;

  const o = ov.data;
  const t = tr.data;
  const p = pf.data;

  const topCat = p?.categories?.[0];
  const topAuthor = p?.authors?.[0];
  const peakHour = p?.timeOfDay?.length
    ? p.timeOfDay.reduce((a, b) => (b.seconds > a.seconds ? b : a))
    : null;

  return (
    <>
      {/* KPI */}
      {ov.loading && !o ? (
        <div className="kpi-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="stat" key={i}>
              <Skeleton w="58%" h={11} />
              <Skeleton w="72%" h={26} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      ) : o ? (
        <div className="kpi-grid">
          <Kpi
            label="累计阅读时长"
            value={Math.round(o.totalHours).toLocaleString('zh-CN')}
            unit="小时"
            foot={`自 ${o.registDate} 起`}
          />
          <Kpi
            label="有效阅读天数"
            value={o.readDays.toLocaleString('zh-CN')}
            unit="天"
            foot={`阅读日均 ${o.avgPerReadDay} 小时`}
          />
          <Kpi
            label="读过 / 读完"
            value={`${o.booksRead} / ${o.booksDone}`}
            unit="本"
            foot={`完读率 ${o.booksRead ? Math.round((o.booksDone / o.booksRead) * 100) : 0}%`}
          />
          <Kpi
            label="笔记总数"
            value={o.notes.toLocaleString('zh-CN')}
            unit="条"
            foot={`覆盖 ${meta?.counts?.noteBooks ?? '—'} 本书`}
          />
          <Kpi
            label="本月阅读"
            value={Math.round((o.currentMonth.seconds || 0) / 3600)}
            unit="小时"
            foot={
              o.currentMonth.compare != null
                ? `较上月 ${o.currentMonth.compare >= 0 ? '+' : ''}${Math.round(
                    o.currentMonth.compare * 100
                  )}%`
                : `${o.currentMonth.days} 天有效阅读`
            }
          />
          <Kpi
            label="本周阅读"
            value={Math.round((o.currentWeek.seconds || 0) / 3600)}
            unit="小时"
            foot={`${o.currentWeek.days} 天有效阅读`}
          />
        </div>
      ) : null}

      {/* 画像一句话 */}
      {p && topCat ? (
        <Card style={{ marginBottom: 16, background: 'linear-gradient(120deg, var(--surface), color-mix(in srgb, var(--accent) 5%, var(--surface)))' }}>
          <div className="sec-label" style={{ marginBottom: 10 }}>
            阅读画像
          </div>
          <div className="profile-quote">
            你的书架偏向
            <span className="hlmark">{p.preferCategoryWord?.replace('偏好阅读', '') || topCat.title}</span>
            ，累计在
            <b> {topCat.title} </b>
            上投入 {Math.round(topCat.hours)} 小时；
            {peakHour ? (
              <>
                最常在 <span className="hlmark">{peakHour.hour}:00–{peakHour.hour + 1}:00</span> 翻开书，
              </>
            ) : null}
            {p.preferTimeWord ? `是一位${p.preferTimeWord.replace('偏好', '')}读者` : '阅读节奏稳定'}。
            {topAuthor ? (
              <>
                反复回到的作者是 <b>{topAuthor.name}</b>（{topAuthor.count} 本 · {topAuthor.readTime}）。
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* 年度 */}
      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', marginBottom: 16 }}>
        <Card>
          <CardHead
            title="逐年阅读时长"
            hint={o ? `${o.firstYear}–${o.lastYear} · ${o.activeYearCount} 年` : ''}
          />
          {tr.loading && !t ? <Skeleton h={236} /> : t ? <YearBars data={t.yearly} /> : null}
        </Card>
        <Card>
          <CardHead title="月度阅读强度" hint={t ? `近 ${t.monthly.length} 个月` : ''} />
          {tr.loading && !t ? (
            <Skeleton h={150} />
          ) : t ? (
            <>
              <MonthHeat data={t.monthly} />
              <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.8 }}>
                色块越深表示当月阅读时长越高；空缺月份表示当月无有效阅读。
              </div>
            </>
          ) : null}
        </Card>
      </div>

      {/* 月度 / 周度 */}
      <div className="grid" style={{ gridTemplateColumns: '1.55fr 1fr', marginBottom: 16 }}>
        <Card>
          <CardHead
            title="月度趋势"
            hint={t?.monthly?.length ? `${t.monthly[0].key} — ${t.monthly.at(-1).key}` : ''}
          />
          {tr.loading && !t ? <Skeleton h={210} /> : t ? <MonthArea data={t.monthly} /> : null}
        </Card>
        <Card>
          <CardHead title="近 12 周节奏" hint={t?.weekly?.length ? '按自然周' : ''} />
          {tr.loading && !t ? <Skeleton h={152} /> : t ? <WeekBars data={t.weekly} /> : null}
        </Card>
      </div>

      {/* 画像细节 */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.2fr', marginBottom: 16 }}>
        <Card>
          <CardHead title="阅读时段分布" hint="24 小时" />
          {pf.loading && !p ? (
            <Skeleton h={250} />
          ) : p ? (
            <DayClock data={p.timeOfDay} label={p.preferTimeWord} />
          ) : null}
        </Card>
        <Card>
          <CardHead title="偏好分类" hint={p?.preferCategoryWord} />
          {pf.loading && !p ? (
            <Skeleton h={240} />
          ) : p?.categories?.length ? (
            <div>
              {p.categories.map((c) => {
                const max = Math.max(...p.categories.map((x) => x.seconds), 1);
                return (
                  <div className="cat-row" key={c.title}>
                    <span className="cl">{c.title}</span>
                    <span className="cb">
                      <i style={{ width: `${Math.max((c.seconds / max) * 100, 2)}%` }} />
                    </span>
                    <span className="cv">
                      {c.hours >= 1 ? `${Math.round(c.hours)} 小时` : `${Math.round(c.seconds / 60)} 分`} ·{' '}
                      {c.count} 本
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty text="暂无分类偏好数据" />
          )}
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
        <Card>
          <CardHead title="偏好作者" hint={p?.authorCount ? `共 ${p.authorCount} 位` : ''} />
          {pf.loading && !p ? (
            <Skeleton h={220} />
          ) : p?.authors?.length ? (
            p.authors.map((a, i) => (
              <div className="author-row" key={a.name}>
                <span className="author-rank">{i + 1}</span>
                <span className="author-name">{a.name}</span>
                <span className="author-stat">{a.count} 本</span>
                <span className="author-stat" style={{ width: 88, textAlign: 'right' }}>
                  {a.readTime}
                </span>
              </div>
            ))
          ) : (
            <Empty text="暂无作者数据" />
          )}
        </Card>
        <Card>
          <CardHead title="偏好出版社" />
          {pf.loading && !p ? (
            <Skeleton h={120} />
          ) : p?.publishers?.length ? (
            <>
              <div className="pub-chips">
                {p.publishers.map((x) => (
                  <span className="pub-chip" key={x.name}>
                    {x.name}
                    <b>{x.count}</b>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 20 }}>
                <div className="sec-label">读得最多的书</div>
                {p.topBooks?.slice(0, 5).map((b) => (
                  <div className="author-row" key={b.bookId}>
                    <span className="author-name">
                      {b.title}
                      {b.isAlbum ? <span className="tag gold" style={{ marginLeft: 6 }}>有声</span> : null}
                    </span>
                    <span className="author-stat">{Math.round(b.hours)} 小时</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty text="暂无出版社数据" />
          )}
        </Card>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--ink-4)', textAlign: 'center', marginTop: 8 }}>
        数据更新于 {fmtDate(meta?.syncedAt)} · 时长口径为服务端 totalReadTime（秒）换算
      </div>
    </>
  );
}