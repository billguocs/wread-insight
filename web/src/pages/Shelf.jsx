import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApi, useDebounced } from '../hooks.js';
import { BookCover, Empty, ErrorBox, Icon, Skeleton } from '../components/ui.jsx';
import BookDetail from '../components/BookDetail.jsx';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'reading', label: '在读' },
  { key: 'finished', label: '读完' },
  { key: 'notes', label: '有笔记' },
  { key: 'album', label: '有声书' },
];

export default function Shelf({ onOpenNotes, meta, onToast }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [limit, setLimit] = useState(120);
  const [openId, setOpenId] = useState(null);
  const [ratings, setRatings] = useState({});
  const requested = useRef(new Set());
  const dq = useDebounced(q, 320);

  const { data, loading, error, reload } = useApi(
    () => api.shelf({ q: dq, filter, sort, limit }),
    [dq, filter, sort, limit]
  );

  // 豆瓣评分分批补全（有缓存，失败静默降级）
  useEffect(() => {
    if (!data?.items?.length) return;
    const pending = data.items
      .filter((i) => i.type === 'book' && i.title && !requested.current.has(i.bookId))
      .slice(0, 12);
    if (!pending.length) return;
    pending.forEach((i) => requested.current.add(i.bookId));
    api
      .doubanBatch(pending.map((i) => ({ bookId: i.bookId, title: i.title, author: i.author })))
      .then((r) => setRatings((prev) => ({ ...prev, ...r.ratings })))
      .catch(() => {});
  }, [data]);

  useEffect(() => {
    setLimit(120);
  }, [dq, filter, sort]);

  const counts = data?.counts;

  return (
    <>
      <div className="shelf-toolbar">
        <div className="search">
          <span
            style={{
              position: 'absolute',
              left: 11,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--ink-4)',
              display: 'flex',
            }}
          >
            <Icon name="search" size={14} />
          </span>
          <input
            className="input"
            placeholder="搜索书名或作者…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? 'on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {counts && f.key === 'all' ? <span className="n">{counts.all}</span> : null}
            {counts && f.key === 'finished' ? <span className="n">{counts.finished}</span> : null}
            {counts && f.key === 'notes' ? <span className="n">{counts.withNotes}</span> : null}
            {counts && f.key === 'album' ? <span className="n">{counts.albums}</span> : null}
          </button>
        ))}

        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">最近阅读</option>
          <option value="notes">笔记最多</option>
          <option value="title">按书名</option>
        </select>

        <span className="shelf-count">
          {loading && !data ? '加载中…' : `共 ${data?.total ?? 0} 项`}
        </span>
      </div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : null}

      {loading && !data ? (
        <div className="book-grid">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i}>
              <Skeleton
                w="100%"
                h={0}
                style={{ aspectRatio: '3 / 4.2', height: 'auto', paddingTop: '138%' }}
              />
              <Skeleton w="86%" h={11} style={{ marginTop: 9 }} />
              <Skeleton w="52%" h={9} style={{ marginTop: 6 }} />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && data && data.items.length === 0 ? (
        <Empty text="没有匹配的书籍" hint="换个关键词或切换筛选条件试试" />
      ) : null}

      {data?.items?.length ? (
        <>
          <div className="book-grid">
            {data.items.map((b) => (
              <div
                key={`${b.type}-${b.bookId}`}
                className="book-card"
                onClick={() => setOpenId(b.bookId)}
              >
                <BookCover
                  src={b.cover}
                  title={b.title}
                  progress={b.progress ?? undefined}
                  badge={
                    <>
                      {b.finishReading ? <span className="fin">已读完</span> : null}
                      {b.noteCount > 0 ? <span className="note-dot">{b.noteCount} 笔记</span> : null}
                      {b.type === 'album' ? (
                        <span
                          className="fin"
                          style={{ background: 'var(--gold)', left: 6, right: 'auto' }}
                        >
                          有声书
                        </span>
                      ) : null}
                    </>
                  }
                />
                <div className="book-meta">
                  <div className="t">{b.title || '未命名'}</div>
                  <div className="a">
                    {b.author || '—'}
                    {ratings[b.bookId]?.matched ? (
                      <span style={{ color: 'var(--gold)', marginLeft: 6 }}>
                        ★ {ratings[b.bookId].rating.toFixed(1)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.total > data.items.length + data.offset ? (
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 120)}>
                加载更多（还有 {data.total - data.items.length - data.offset} 项）
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <BookDetail
        bookId={openId}
        onClose={() => setOpenId(null)}
        onPick={setOpenId}
        onOpenNotes={onOpenNotes}
        onToast={onToast}
        ratingOverride={openId ? ratings[openId] : null}
      />
    </>
  );
}