import React, { useEffect, useState } from 'react';
import { api, wereadLink } from '../api.js';
import {
  BookCover,
  ErrorBox,
  Icon,
  Modal,
  Rating,
  Skeleton,
  Stars,
  fmtDate,
  fmtDuration,
  fmtNum,
} from './ui.jsx';

/** 书籍详情弹层：书籍信息 + 双评分 + 进度 + 我的笔记 + 相似推荐 */
export default function BookDetail({ bookId, onClose, onPick, onOpenNotes, onToast, ratingOverride }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [similar, setSimilar] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    if (!bookId) {
      setDetail(null);
      setSimilar(null);
      setExpanded(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    setSimilar(null);
    setExpanded(false);
    api
      .book(bookId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [bookId]);

  const loadSimilar = async () => {
    setSimLoading(true);
    try {
      const r = await api.similar({ bookId, count: 8 });
      setSimilar(r.books || []);
    } catch (e) {
      onToast?.(e.message || '相似推荐加载失败');
    } finally {
      setSimLoading(false);
    }
  };

  const douban = detail?.douban || ratingOverride;
  const progress = detail?.progress?.percent ?? 0;

  return (
    <Modal open={!!bookId} onClose={onClose}>
      {loading ? (
        <div style={{ padding: 28 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Skeleton w={96} h={134} />
            <div style={{ flex: 1 }}>
              <Skeleton w="62%" h={22} />
              <Skeleton w="34%" h={12} style={{ marginTop: 12 }} />
              <Skeleton w="46%" h={12} style={{ marginTop: 8 }} />
            </div>
          </div>
          <Skeleton h={11} style={{ marginTop: 26 }} />
          <Skeleton h={11} style={{ marginTop: 9, width: '94%' }} />
          <Skeleton h={11} style={{ marginTop: 9, width: '78%' }} />
        </div>
      ) : null}

      {err ? (
        <div style={{ padding: 28 }}>
          <ErrorBox error={err} onRetry={() => setDetail(null)} />
        </div>
      ) : null}

      {detail && !loading ? (
        <>
          <div className="modal-head">
            <div className="modal-cover">
              {detail.cover ? <img src={detail.cover} alt={detail.title} /> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="modal-title">{detail.title}</div>
              <div className="modal-author">
                {detail.author || '—'}
                {detail.translator ? ` · ${detail.translator} 译` : ''}
              </div>
              <div className="modal-meta-row">
                {detail.category ? <span className="tag">{detail.category}</span> : null}
                {detail.publisher ? <span className="tag">{detail.publisher}</span> : null}
                {detail.publishTime ? <span className="tag">{detail.publishTime}</span> : null}
                {detail.wordCount ? <span className="tag">{fmtNum(detail.wordCount)} 字</span> : null}
                {detail.inShelf ? <span className="tag teal">书架中</span> : null}
              </div>
              <div className="rating-row">
                <div className="rating-item">
                  <span className="rl">豆瓣</span>
                  <span
                    className="rn"
                    style={{ color: douban?.matched ? 'var(--gold)' : 'var(--ink-4)' }}
                  >
                    {douban?.matched ? douban.rating.toFixed(1) : '—'}
                  </span>
                  {douban?.matched ? (
                    <>
                      <Stars value={douban.rating} />
                      <span className="rv">{fmtNum(douban.votes)}人</span>
                    </>
                  ) : (
                    <span className="rv">暂无评分</span>
                  )}
                </div>
                <Rating
                  label="微信读书"
                  value={detail.wereadRating}
                  sub={detail.wereadRatingCount ? `${fmtNum(detail.wereadRatingCount)}人` : ''}
                />
              </div>
            </div>
          </div>

          <div className="modal-body">
            {detail.intro ? (
              <div style={{ marginBottom: 18 }}>
                <div className="sec-label">内容简介</div>
                <div className="intro-wrap">
                  <div className={`intro-text ${expanded ? 'open' : ''}`}>{detail.intro}</div>
                  {!expanded ? <div className="intro-fade" /> : null}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 6, paddingLeft: 0 }}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? '收起' : '展开全文'}
                </button>
              </div>
            ) : null}

            <div className="mini-grid">
              <div className="mini">
                <div className="k">阅读进度</div>
                <div className="v">{progress}%</div>
                <div className="progress-track" style={{ marginTop: 6 }}>
                  <i style={{ width: `${Math.min(progress, 100)}%` }} />
                </div>
              </div>
              <div className="mini">
                <div className="k">累计阅读</div>
                <div className="v" style={{ fontSize: 14 }}>
                  {detail.progress?.recordReadingTime
                    ? fmtDuration(detail.progress.recordReadingTime)
                    : progress > 0
                      ? '无时长记录'
                      : '未开始'}
                </div>
              </div>
              <div className="mini">
                <div className="k">我的笔记</div>
                <div className="v">
                  {(detail.myNotes?.highlights || 0) + (detail.myNotes?.reviews || 0)}
                  <small style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 3 }}>条</small>
                </div>
              </div>
              <div className="mini">
                <div className="k">最近阅读</div>
                <div className="v" style={{ fontSize: 12.5, fontFamily: 'var(--sans)' }}>
                  {detail.progress?.updateTime
                    ? fmtDate(new Date(detail.progress.updateTime * 1000).toISOString()).slice(0, 10)
                    : '—'}
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <a
                className="btn btn-primary"
                href={wereadLink(detail.bookId)}
                onClick={() => onToast?.('正在唤起微信读书…')}
              >
                <Icon name="book" size={14} />
                去微信读书阅读
              </a>
              {detail.myNotes && detail.myNotes.highlights + detail.myNotes.reviews > 0 ? (
                <button
                  className="btn"
                  onClick={() => {
                    onOpenNotes?.(detail.bookId);
                    onClose();
                  }}
                >
                  <Icon name="note" size={14} />
                  查看我的笔记（{detail.myNotes.highlights + detail.myNotes.reviews}）
                </button>
              ) : null}
              <button className="btn" onClick={loadSimilar} disabled={simLoading}>
                {simLoading ? <span className="spin" /> : <Icon name="compass" size={14} />}
                相似推荐
              </button>
              {douban?.matched ? (
                <a className="btn" href={douban.url} target="_blank" rel="noreferrer">
                  <Icon name="external" size={13} />
                  豆瓣页
                </a>
              ) : null}
            </div>

            {detail.warnings?.length ? (
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--ink-4)' }}>
                部分数据获取失败：{detail.warnings.join('；')}
              </div>
            ) : null}

            {similar ? (
              <div style={{ marginTop: 22 }}>
                <div className="sec-label">相似书籍</div>
                {similar.length === 0 ? (
                  <div className="empty" style={{ padding: 20 }}>
                    暂无相似推荐
                  </div>
                ) : (
                  <div className="similar-list">
                    {similar.map((s) => (
                      <div key={s.bookId} className="book-card" onClick={() => onPick?.(s.bookId)}>
                        <BookCover src={s.cover} title={s.title} />
                        <div className="book-meta">
                          <div className="t" style={{ fontSize: 11.5 }}>
                            {s.title}
                          </div>
                          <div className="a" style={{ fontSize: 10 }}>
                            {s.author}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}