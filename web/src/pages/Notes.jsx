import React, { useEffect, useMemo, useState } from 'react';
import { api, wereadLink } from '../api.js';
import { useApi, useDebounced } from '../hooks.js';
import {
  Card,
  Empty,
  ErrorBox,
  Highlight,
  Icon,
  Skeleton,
  fmtDate,
} from '../components/ui.jsx';

const EXPORTS = [
  { f: 'md', label: 'Markdown' },
  { f: 'json', label: 'JSON' },
  { f: 'csv', label: 'CSV' },
];

export default function Notes({ initialBookId, onToast, meta }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('total');
  const [selected, setSelected] = useState(initialBookId || null);
  const [globalQ, setGlobalQ] = useState('');
  const [searchType, setSearchType] = useState('all');
  const dq = useDebounced(q, 300);
  const dg = useDebounced(globalQ, 380);

  const books = useApi(() => api.noteBooks({ q: dq, sort }), [dq, sort]);
  const detail = useApi(
    ({ signal }) => api.noteBook(selected),
    [selected],
    { skip: !selected }
  );
  const search = useApi(
    () => api.noteSearch({ q: dg, type: searchType }),
    [dg, searchType],
    { skip: !dg.trim() }
  );

  // 默认选中笔记最多的一本
  useEffect(() => {
    if (!selected && books.data?.books?.length) setSelected(books.data.books[0].bookId);
  }, [books.data, selected]);

  useEffect(() => {
    if (initialBookId) setSelected(initialBookId);
  }, [initialBookId]);

  const stats = books.data?.stats;
  const list = books.data?.books || [];
  const searching = !!dg.trim();

  const download = (fmt, bookId) => {
    const url = api.exportUrl({ format: fmt, ...(bookId ? { bookId } : {}) });
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onToast?.(`开始导出 ${fmt.toUpperCase()} 文件`);
  };

  return (
    <>
      {/* 顶部统计 + 全局导出 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {stats ? (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <MiniStat label="有笔记的书" value={stats.books} />
            <MiniStat label="划线" value={stats.highlights} color="var(--hl)" />
            <MiniStat label="想法点评" value={stats.reviews} color="var(--rev)" />
            <MiniStat label="书签" value={stats.bookmarks} color="var(--rev)" />
            <MiniStat label="合计" value={stats.all} />
          </div>
        ) : (
          <Skeleton w={420} h={16} />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>导出全部</span>
          {EXPORTS.map((e) => (
            <button key={e.f} className="btn btn-sm" onClick={() => download(e.f)}>
              <Icon name="download" size={12} />
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <div className="notes-layout">
        {/* 左侧书单 */}
        <div className="notes-list">
          <div className="notes-list-head">
            <div style={{ position: 'relative', marginBottom: 9 }}>
              <input
                className="input"
                style={{ paddingLeft: 30 }}
                placeholder="筛选书名 / 作者"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-4)',
                  display: 'flex',
                }}
              >
                <Icon name="search" size={13} />
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`chip ${sort === 'total' ? 'on' : ''}`}
                onClick={() => setSort('total')}
              >
                笔记最多
              </button>
              <button
                className={`chip ${sort === 'recent' ? 'on' : ''}`}
                onClick={() => setSort('recent')}
              >
                最近
              </button>
              <button
                className={`chip ${sort === 'title' ? 'on' : ''}`}
                onClick={() => setSort('title')}
              >
                书名
              </button>
            </div>
          </div>

          <div className="notes-list-scroll">
            {books.loading && !books.data
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{ padding: '12px 15px' }}>
                    <Skeleton w="72%" h={12} />
                    <Skeleton w="44%" h={9} style={{ marginTop: 6 }} />
                  </div>
                ))
              : null}
            {books.error ? <ErrorBox error={books.error} onRetry={books.reload} /> : null}
            {!books.loading && list.length === 0 ? (
              <Empty text="没有匹配的书" hint="试试清空筛选条件" />
            ) : null}
            {list.map((b) => (
              <div
                key={b.bookId}
                className={`note-book ${selected === b.bookId ? 'on' : ''}`}
                onClick={() => {
                  setSelected(b.bookId);
                  setGlobalQ('');
                }}
              >
                {b.cover ? (
                  <img className="nb-cover" src={b.cover} alt="" loading="lazy" />
                ) : (
                  <div className="nb-cover" />
                )}
                <div className="nb-main">
                  <div className="nb-t">{b.title}</div>
                  <div className="nb-a">{b.author || '—'}</div>
                </div>
                <div className="nb-c">
                  <b>{b.total}</b>
                  <div style={{ fontSize: 9.5 }}>
                    {b.highlights}划 / {b.reviews}想
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧内容 */}
        <div className="note-detail">
          <div className="note-detail-head">
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
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
                placeholder="在所有笔记中搜索关键词…"
                value={globalQ}
                onChange={(e) => setGlobalQ(e.target.value)}
              />
            </div>
            {searching ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  ['all', '全部'],
                  ['highlight', '划线'],
                  ['review', '想法'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    className={`chip ${searchType === k ? 'on' : ''}`}
                    onClick={() => setSearchType(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="note-detail-body">
            {searching ? (
              <SearchResults
                query={dg}
                loading={search.loading}
                data={search.data}
                error={search.error}
              />
            ) : (
              <BookNotes
                detail={detail}
                onDownload={download}
                onOpen={(id) => setSelected(id)}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--serif)',
          fontSize: 18,
          fontWeight: 600,
          color: color || 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SearchResults({ query, loading, data, error }) {
  if (loading && !data) return <Skeleton h={90} style={{ marginTop: 18 }} />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  if (!data.hits.length)
    return <Empty text={`没有找到包含「${query}」的笔记`} hint="换个关键词试试" />;

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        命中 <b>{data.total}</b> 条{data.total > data.hits.length ? `（显示前 ${data.hits.length} 条）` : ''}
      </div>
      {data.hits.map((h, i) => (
        <div className="search-hit" key={i}>
          <div className="sm">
            <span className="tag accent">{h.kind === 'highlight' ? '划线' : '想法'}</span>
            <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{h.book}</span>
            {h.chapter ? <span>· {h.chapter}</span> : null}
            <span style={{ marginLeft: 'auto' }}>{h.date}</span>
          </div>
          <div className="tx">
            <Highlight text={h.text} keyword={query} />
          </div>
        </div>
      ))}
    </div>
  );
}

function BookNotes({ detail, onDownload, onOpen }) {
  if (detail.loading && !detail.data) return <Skeleton h={200} style={{ marginTop: 18 }} />;
  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  const d = detail.data;
  if (!d) return <Empty text="从左侧选择一本书查看笔记" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 0 4px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 17, lineHeight: 1.4 }}>
            <a
              href={wereadLink(d.bookId)}
              style={{ borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}
            >
              {d.title}
            </a>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>
            {d.author || '—'} · 划线 {d.counts.highlights} · 想法 {d.counts.reviews}
            {d.counts.bookmarks ? ` · 书签 ${d.counts.bookmarks}` : ''}
            {d.progress != null ? ` · 进度 ${d.progress}%` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {EXPORTS.map((e) => (
            <button
              key={e.f}
              className="btn btn-sm"
              onClick={() => onDownload(e.f, d.bookId)}
              title={`导出《${d.title}》的笔记`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {d.chapters.length === 0 && d.reviews.length === 0 ? (
        <Empty text="这本书没有可导出的笔记内容" />
      ) : null}

      {d.chapters.map((ch) => (
        <div className="chapter-block" key={ch.title}>
          <div className="chapter-title">
            {ch.title} <em>{ch.items.length} 条</em>
          </div>
          {ch.items.map((h, i) => (
            <div className="hl-quote" key={h.bookmarkId || i}>
              {h.markText}
              <div className="hl-date">
                {fmtDate(h.createTime ? new Date(h.createTime * 1000).toISOString() : null)}
              </div>
            </div>
          ))}
        </div>
      ))}

      {d.reviews.length ? (
        <div className="chapter-block">
          <div className="chapter-title">
            想法与点评 <em>{d.reviews.length} 条</em>
          </div>
          {d.reviews.map((r, i) => (
            <div className="review-item" key={r.reviewId || i}>
              <div className="review-head">
                <span className="review-kind">{r.kind}</span>
                {r.chapterName ? <span>{r.chapterName}</span> : null}
                {r.star > 0 ? <span>{'★'.repeat(r.star)}</span> : null}
                <span style={{ marginLeft: 'auto' }}>{r.date}</span>
              </div>
              <div className="review-content">{r.content}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}