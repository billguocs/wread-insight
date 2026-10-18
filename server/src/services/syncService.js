import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { wereadCall, createLimiter } from '../integrations/wereadClient.js';
import * as store from '../repositories/snapshotStore.js';

/**
 * 同步编排（按档案隔离）。
 * quick：阅读统计 + 书架 + 笔记本概览（约 10-20s）
 * full ：quick + 逐本划线与想法全文（约 30-60s）
 * 每个档案独立的同步状态，供前端短轮询。
 */
const states = new Map(); // profileId -> state

function stateOf(profileId) {
  if (!states.has(profileId)) {
    states.set(profileId, {
      status: 'idle', // idle | running | error
      mode: null,
      step: '',
      done: 0,
      total: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
    });
  }
  return states.get(profileId);
}

export function getStatus(profileId) {
  if (!profileId) return { status: 'idle', step: '', done: 0, total: 0 };
  return { ...stateOf(profileId) };
}

export function isRunning(profileId) {
  return profileId ? stateOf(profileId).status === 'running' : false;
}

export function forgetState(profileId) {
  states.delete(profileId);
}

// ---------- 时间工具 ----------
function monthStart(year, month /* 1-12 */) {
  return new Date(year, month - 1, 1, 0, 0, 0).getTime() / 1000;
}

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return Math.floor(d.getTime() / 1000);
}

function recentMonths(n) {
  const list = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push([d.getFullYear(), d.getMonth() + 1]);
  }
  return list.reverse();
}

function recentWeeks(n) {
  const base = mondayOf(new Date());
  const list = [];
  for (let i = 0; i < n; i++) list.push(base - i * 7 * 86400);
  return list.reverse();
}

// ---------- 统计 ----------
async function collectReadData(ctx) {
  const st = stateOf(ctx.profileId);
  const auth = { requestId: ctx.requestId, apiKey: ctx.apiKey };
  const out = {};

  st.step = '阅读统计总览';
  const overall = await wereadCall('/readdata/detail', { mode: 'overall' }, auth);
  out.overall = overall;

  // 从 overall.readTimes 的年份分桶推导出需要逐年查询的年份
  const years = new Set();
  for (const ts of Object.keys(overall.readTimes || {})) {
    const y = new Date(Number(ts) * 1000).getFullYear();
    if (y > 2000) years.add(y);
  }
  if (overall.registTime) years.add(new Date(overall.registTime * 1000).getFullYear());
  years.add(new Date().getFullYear());

  const sortedYears = [...years].sort((a, b) => a - b);
  out.annually = {};
  for (const y of sortedYears) {
    st.step = `阅读统计 ${y} 年`;
    try {
      out.annually[String(y)] = await wereadCall(
        '/readdata/detail',
        { mode: 'annually', baseTime: monthStart(y, 1) },
        auth
      );
    } catch (err) {
      logger.warn('annual_fetch_failed', { requestId: ctx.requestId, year: y, error: err.message });
    }
  }

  st.step = '月度趋势';
  out.monthly_hist = {};
  for (const [y, m] of recentMonths(config.sync.monthlyWindow)) {
    try {
      out.monthly_hist[`${y}-${String(m).padStart(2, '0')}`] = await wereadCall(
        '/readdata/detail',
        { mode: 'monthly', baseTime: monthStart(y, m) },
        auth
      );
    } catch (err) {
      logger.warn('monthly_fetch_failed', { requestId: ctx.requestId, year: y, month: m });
    }
  }

  st.step = '周度趋势';
  out.weekly_hist = {};
  for (const bt of recentWeeks(config.sync.weeklyWindow)) {
    try {
      const r = await wereadCall('/readdata/detail', { mode: 'weekly', baseTime: bt }, auth);
      const d = new Date(bt * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      out.weekly_hist[key] = r;
    } catch (err) {
      logger.warn('weekly_fetch_failed', { requestId: ctx.requestId, error: err.message });
    }
  }

  st.step = '本周与本月';
  try {
    out.weekly = await wereadCall('/readdata/detail', { mode: 'weekly' }, auth);
  } catch (err) {
    logger.warn('current_week_failed', { requestId: ctx.requestId, error: err.message });
  }
  try {
    out.monthly = await wereadCall('/readdata/detail', { mode: 'monthly' }, auth);
  } catch (err) {
    logger.warn('current_month_failed', { requestId: ctx.requestId, error: err.message });
  }

  return out;
}

// ---------- 书架 ----------
async function collectShelf(ctx) {
  stateOf(ctx.profileId).step = '书架';
  return wereadCall('/shelf/sync', {}, { requestId: ctx.requestId, apiKey: ctx.apiKey });
}

// ---------- 笔记本概览 ----------
async function collectNotebooks(ctx) {
  stateOf(ctx.profileId).step = '笔记本概览';
  const auth = { requestId: ctx.requestId, apiKey: ctx.apiKey };
  const books = [];
  let lastSort = null;
  for (let guard = 0; guard < 60; guard++) {
    const params = { count: 100 };
    if (lastSort) params.lastSort = lastSort;
    // eslint-disable-next-line no-await-in-loop
    const r = await wereadCall('/user/notebooks', params, auth);
    const batch = r.books || [];
    books.push(...batch);
    if (r.hasMore !== 1 || batch.length === 0) break;
    lastSort = batch[batch.length - 1].sort;
  }
  return {
    totalBookCount: books.length,
    totalNoteCount: books.reduce(
      (s, b) => s + (b.reviewCount || 0) + (b.noteCount || 0) + (b.bookmarkCount || 0),
      0
    ),
    books,
  };
}

// ---------- 笔记全文 ----------
async function collectNotes(ctx, notebooks, prev = {}) {
  const st = stateOf(ctx.profileId);
  const auth = { requestId: ctx.requestId, apiKey: ctx.apiKey };
  const books = [...(notebooks.books || [])].sort(
    (a, b) =>
      (b.reviewCount || 0) + (b.noteCount || 0) + (b.bookmarkCount || 0) -
      ((a.reviewCount || 0) + (a.noteCount || 0) + (a.bookmarkCount || 0))
  );

  st.total = books.length;
  st.done = 0;
  const limit = createLimiter(3);
  const result = {};

  await Promise.all(
    books.map((b) =>
      limit(async () => {
        const bid = String(b.bookId);
        const entry = {
          bookId: bid,
          title: b.book?.title || '',
          author: b.book?.author || '',
          cover: b.book?.cover || '',
          counts: {
            review: b.reviewCount || 0,
            note: b.noteCount || 0,
            bookmark: b.bookmarkCount || 0,
          },
          readingProgress: b.readingProgress ?? null,
          markedStatus: b.markedStatus ?? null,
          highlights: [],
          reviews: [],
        };

        try {
          const bm = await wereadCall('/book/bookmarklist', { bookId: bid }, auth);
          const chapters = {};
          for (const c of bm.chapters || []) {
            if (c.chapterUid != null) {
              chapters[c.chapterUid] = { title: c.title || '', idx: c.chapterIdx ?? null };
            }
          }
          for (const u of bm.updated || []) {
            const ch = chapters[u.chapterUid];
            entry.highlights.push({
              bookmarkId: u.bookmarkId,
              chapterUid: u.chapterUid,
              chapterTitle: ch?.title || '',
              chapterIdx: ch?.idx ?? null,
              markText: u.markText || '',
              range: String(u.range || ''),
              createTime: u.createTime || 0,
              colorStyle: u.colorStyle || 0,
            });
          }
        } catch (err) {
          logger.warn('bookmarklist_failed', { requestId: ctx.requestId, bookId: bid });
        }

        try {
          let synckey = 0;
          for (let guard = 0; guard < 30; guard++) {
            const rv = await wereadCall(
              '/review/list/mine',
              { bookid: bid, synckey, count: 100 },
              auth
            );
            for (const item of rv.reviews || []) {
              const r = item.review || {};
              entry.reviews.push({
                reviewId: r.reviewId,
                content: r.content || '',
                createTime: r.createTime || 0,
                star: r.star ?? -1,
                chapterName: r.chapterName || '',
                isFinish: r.isFinish ?? 0,
                type: r.type ?? 0,
              });
            }
            if (rv.hasMore !== 1) break;
            const nk = rv.synckey;
            if (!nk || nk === synckey) break;
            synckey = nk;
          }
        } catch (err) {
          logger.warn('reviews_failed', { requestId: ctx.requestId, bookId: bid });
        }

        // 抓取失败保护：本次没拿到任何内容但历史上有时，保留旧数据
        const old = prev[bid];
        const oldCount = old ? (old.highlights?.length || 0) + (old.reviews?.length || 0) : 0;
        if (oldCount > 0 && entry.highlights.length === 0 && entry.reviews.length === 0) {
          entry.highlights = old.highlights || [];
          entry.reviews = old.reviews || [];
          entry.stale = true;
          logger.warn('notes_kept_previous', { requestId: ctx.requestId, bookId: bid });
        }

        result[bid] = entry;
        st.done += 1;
        st.step = `笔记 ${st.done}/${st.total}`;
      })
    )
  );

  return result;
}

// ---------- 执行入口 ----------
async function execute(ctx, mode) {
  const st = stateOf(ctx.profileId);
  const t0 = Date.now();
  Object.assign(st, {
    status: 'running',
    mode,
    step: '开始',
    done: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });

  try {
    const cur = await store.load(ctx.profileId);
    const readdata = await collectReadData(ctx);
    const shelf = await collectShelf(ctx);
    const notebooks = await collectNotebooks(ctx);

    let notes = cur.notes || {};
    if (mode === 'full') {
      notes = await collectNotes(ctx, notebooks, cur.notes || {});
    }

    const now = new Date().toISOString();
    const next = {
      ...cur,
      readdata,
      shelf,
      notebooks,
      notes,
      syncedAt: now,
      quickSyncedAt: now,
      fullSyncedAt: mode === 'full' ? now : cur.fullSyncedAt,
    };

    await store.enqueueWrite(ctx.profileId, () => store.save(ctx.profileId, next));

    Object.assign(st, { status: 'idle', step: '完成', finishedAt: new Date().toISOString() });
    logger.info('sync_done', {
      requestId: ctx.requestId,
      profileId: ctx.profileId,
      mode,
      books: notebooks.totalBookCount,
      ms: Date.now() - t0,
    });
  } catch (err) {
    Object.assign(st, {
      status: 'error',
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
    logger.error('sync_failed', {
      requestId: ctx.requestId,
      profileId: ctx.profileId,
      mode,
      error: err.message,
    });
    throw err;
  }
}

export function startSync(ctx, mode = 'quick') {
  if (isRunning(ctx.profileId)) {
    return { started: false, reason: 'already_running', status: getStatus(ctx.profileId) };
  }
  execute(ctx, mode).catch(() => {});
  return { started: true, status: getStatus(ctx.profileId) };
}

export function staleness(snapshot) {
  const now = Date.now();
  const quickAt = snapshot?.quickSyncedAt ? new Date(snapshot.quickSyncedAt).getTime() : 0;
  const fullAt = snapshot?.fullSyncedAt ? new Date(snapshot.fullSyncedAt).getTime() : 0;
  return {
    quickStale: now - quickAt > config.sync.quickTtlMs,
    fullStale: now - fullAt > config.sync.fullTtlMs,
    quickAgeMs: quickAt ? now - quickAt : null,
    fullAgeMs: fullAt ? now - fullAt : null,
  };
}

/** 访问时若数据过旧则后台自动刷新，请求立即返回旧数据 */
export async function ensureFresh(ctx) {
  if (!ctx?.apiKey) return { triggered: null, reason: 'no_key' };
  const snap = await store.load(ctx.profileId);
  if (!snap.syncedAt) {
    startSync(ctx, 'full');
    return { triggered: 'full', reason: 'no_data' };
  }
  if (isRunning(ctx.profileId)) return { triggered: null, reason: 'running' };
  const s = staleness(snap);
  if (s.fullStale) {
    startSync(ctx, 'full');
    return { triggered: 'full', reason: 'full_stale' };
  }
  if (s.quickStale) {
    startSync(ctx, 'quick');
    return { triggered: 'quick', reason: 'quick_stale' };
  }
  return { triggered: null, reason: 'fresh' };
}