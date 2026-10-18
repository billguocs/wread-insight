import React, { useEffect, useRef, useState } from 'react';
import { api, SCOPE_OPTIONS } from '../api.js';
import { useApi, useDebounced } from '../hooks.js';
import { BookCover, Empty, ErrorBox, Icon, Skeleton, Stars } from '../components/ui.jsx';
import BookDetail from '../components/BookDetail.jsx';

export default function Discover({ onToast, onOpenNotes }) {
  const [tab, setTab] = useState('recommend');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [ratings, setRatings] = useState({});
  const requested = useRef(new Set());

  const [kw, setKw] = useState('');
  const [scope, setScope] = useState(10);
  const [submitted, setSubmitted] = useState('');
  const dq = useDebounced(kw, 400);

  const rec = useApi(() => api.recommend({ count: 12, offset }), [offset]);

  // 搜索：输入防抖后自动查询
  const search = useApi(
    () => api.search({ q: dq, scope, count: 15 }),
    [dq, scope],
    { skip: !dq.trim() }
  );

  // 豆瓣评分补全（推荐流）
  useEffect(() => {
    const books = rec.data?.books || [];
    if (!books.length) return;
    const pending = books.filter((b) => b.title && !requested.current.has(b.bookId)).slice(0, 12);
    if (!pending.length) return;
    pending.forEach((b) => requested.current.add(b.bookId));
    api
      .doubanBatch(pending.map((b) => ({ bookId: b.bookId, title: b.title, author: b.author })))
      .then((r) => setRatings((prev) => ({ ...prev, ...r.ratings })))
      .catch(() => {});
  }, [rec.data]);

  const searchBooks = (search.data?.groups || []).flatMap((g) => g.books);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <div className="tabs">
          <button
            className={`tab ${tab === 'recommend' ? 'on' : ''}`}
            onClick={() => setTab('recommend')}
          >
            为你推荐
          </button>
          <button className={`tab ${tab === 'search' ? 'on' : ''}`} onClick={() => setTab('search')}>
            搜索书城
          </button>
        </div>

        {tab === 'recommend' ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              基于你的阅读记录生成，与 App 首页一致
            </span>
            <button className="btn btn-sm" onClick={() => setOffset((o) => o + 12)}>
              <Icon name="refresh" size={12} />
              换一批
            </button>
          </div>
        ) : null}
      </div>

      {tab === 'recommend' ? (
        <>
          {rec.error ? <ErrorBox error={rec.error} onRetry={rec.reload} /> : null}
          {rec.loading && !rec.data ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div className="card" key={i} style={{ display: 'flex', gap: 13 }}>
                  <Skeleton w={62} h={87} />
                  <div style={{ flex: 1 }}>
                    <Skeleton w="66%" h={13} />
                    <Skeleton w="38%" h={10} style={{ marginTop: 8 }} />
                    <Skeleton w="92%" h={10} style={{ marginTop: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {rec.data?.books?.length ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
              {rec.data.books.map((b) => (
                <div className="rec-card" key={b.bookId} onClick={() => setOpenId(b.bookId)} style={{ cursor: 'pointer' }}>
                  <BookCover src={b.cover} title={b.title} className="rec-cover" />
                  <div className="rec-main">
                    <div className="rec-title">{b.title}</div>
                    <div className="rec-author">
                      {b.author || '—'}
                      {b.douban?.matched || ratings[b.bookId]?.matched ? (
                        <span style={{ color: 'var(--gold)', marginLeft: 6 }}>
                          ★ {(ratings[b.bookId]?.rating ?? b.douban?.rating).toFixed(1)}
                        </span>
                      ) : null}
                      {b.wereadRating ? (
                        <span style={{ color: 'var(--teal)', marginLeft: 8 }}>
                          微读 {b.wereadRating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                    {b.reason ? <div className="rec-reason">{b.reason}</div> : null}
                    {b.intro ? <div className="rec-intro">{b.intro}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {!rec.loading && rec.data && rec.data.books.length === 0 ? (
            <Empty text="暂无推荐" />
          ) : null}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
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
                style={{ paddingLeft: 33 }}
                placeholder="搜索书名、作者、关键词…"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setSubmitted(kw)}
              />
            </div>
            <select
              className="select"
              value={scope}
              onChange={(e) => setScope(Number(e.target.value))}
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {search.error ? <ErrorBox error={search.error} onRetry={search.reload} /> : null}
          {search.loading && !search.data
            ? Array.from({ length: 4 }).map((_, i) => (
                <div className="card" key={i} style={{ marginBottom: 10, display: 'flex', gap: 13 }}>
                  <Skeleton w={62} h={87} />
                  <div style={{ flex: 1 }}>
                    <Skeleton w="52%" h={13} />
                    <Skeleton w="30%" h={10} style={{ marginTop: 8 }} />
                  </div>
                </div>
              ))
            : null}

          {!dq.trim() ? (
            <Empty text="输入关键词开始搜索" hint="支持电子书、有声书、网文、作者、书单" />
          ) : null}

          {search.data?.groups?.map((g) => (
            <div key={`${g.scope}-${g.title}`} style={{ marginBottom: 20 }}>
              <div className="sec-label" style={{ marginBottom: 10 }}>
                {g.title} {g.total ? `· 共 ${g.total} 个结果` : ''}
              </div>
              <div
                className="grid"
                style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}
              >
                {g.books.map((b) => (
                  <div
                    className="rec-card"
                    key={b.bookId}
                    onClick={() => setOpenId(b.bookId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <BookCover src={b.cover} title={b.title} className="rec-cover" />
                    <div className="rec-main">
                      <div className="rec-title">
                        {b.title}
                        {b.soldout ? (
                          <span className="tag" style={{ marginLeft: 6 }}>
                            已下架
                          </span>
                        ) : null}
                      </div>
                      <div className="rec-author">
                        {b.author || '—'}
                        {ratings[b.bookId]?.matched ? (
                          <span style={{ color: 'var(--gold)', marginLeft: 6 }}>
                            ★ {ratings[b.bookId].rating.toFixed(1)}
                          </span>
                        ) : null}
                        {b.wereadRating ? (
                          <span style={{ color: 'var(--teal)', marginLeft: 8 }}>
                            微读 {b.wereadRating.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                      {b.intro ? <div className="rec-intro">{b.intro}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {search.data && searchBooks.length === 0 && dq.trim() ? (
            <Empty text={`没有找到与「${dq}」相关的内容`} hint="试试更换搜索类型或关键词" />
          ) : null}
        </>
      )}

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