import * as store from '../repositories/snapshotStore.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { wereadCall } from '../integrations/wereadClient.js';
import { getRating } from '../integrations/doubanClient.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 微信读书评分统一到 10 分制。
 * 不同接口量纲不一致：/store/search 返回 93（百分制一位小数），
 * /book/info 返回 910（百分制 ×10）。统一归一化避免出现 91.0 这种错误展示。
 */
function toTenPoint(v) {
  const n = Number(v);
  if (!n) return null;
  const ten = n > 100 ? n / 100 : n / 10;
  return +ten.toFixed(1);
}

function trimDate(s) {
  return String(s || '').slice(0, 10);
}

/** 书架列表：电子书 + 专辑 + 文章收藏入口，口径与 skill 规范一致 */
export async function listShelf(
  { q = '', filter = 'all', sort = 'recent', limit = 120, offset = 0 } = {},
  profileId
) {
  const snap = await store.load(profileId);
  const shelf = snap.shelf;
  if (!shelf) throw new NotFoundError('暂无书架数据，请先触发同步');

  const notesByBook = snap.notes || {};
  const items = [];

  for (const b of shelf.books || []) {
    const n = notesByBook[String(b.bookId)];
    items.push({
      type: 'book',
      bookId: String(b.bookId),
      title: b.title || '',
      author: b.author || '',
      cover: b.cover || '',
      category: b.category || '',
      readUpdateTime: b.readUpdateTime || 0,
      finishReading: b.finishReading === 1,
      secret: b.secret === 1,
      isTop: b.isTop === 1,
      progress: n?.readingProgress ?? null,
      noteCount: n ? (n.counts.note || 0) + (n.counts.review || 0) + (n.counts.bookmark || 0) : 0,
    });
  }

  for (const a of shelf.albums || []) {
    const info = a.albumInfo || {};
    const extra = a.albumInfoExtra || {};
    items.push({
      type: 'album',
      bookId: String(info.albumId || ''),
      title: info.name || '',
      author: info.authorName || '',
      cover: info.cover || '',
      category: '有声书',
      trackCount: info.trackCount || 0,
      readUpdateTime: extra.lectureReadUpdateTime || info.updateTime || 0,
      finishReading: info.finish === 1,
      secret: extra.secret === 1,
      isTop: extra.isTop === 1,
      progress: null,
      noteCount: 0,
    });
  }

  let filtered = items;
  if (filter === 'finished') filtered = filtered.filter((i) => i.finishReading);
  else if (filter === 'reading') filtered = filtered.filter((i) => !i.finishReading && i.readUpdateTime > 0);
  else if (filter === 'notes') filtered = filtered.filter((i) => i.noteCount > 0);
  else if (filter === 'album') filtered = filtered.filter((i) => i.type === 'album');

  if (q.trim()) {
    const kw = q.trim().toLowerCase();
    filtered = filtered.filter(
      (i) => i.title.toLowerCase().includes(kw) || i.author.toLowerCase().includes(kw)
    );
  }

  if (sort === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  else if (sort === 'notes') filtered.sort((a, b) => b.noteCount - a.noteCount);
  else filtered.sort((a, b) => (b.readUpdateTime || 0) - (a.readUpdateTime || 0));

  // 置顶优先
  filtered.sort((a, b) => Number(b.isTop) - Number(a.isTop));

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  return {
    total,
    offset,
    limit,
    counts: {
      all: items.length,
      books: (shelf.books || []).length,
      albums: (shelf.albums || []).length,
      mp: shelf.mp ? 1 : 0,
      finished: items.filter((i) => i.finishReading).length,
      withNotes: items.filter((i) => i.noteCount > 0).length,
    },
    items: page,
  };
}

/** 单本详情：书籍信息 + 阅读进度 + 豆瓣评分 + 我的笔记数 */
export async function getBookDetail(bookId, { profileId, apiKey, requestId } = {}) {
  if (!bookId) throw new ValidationError('缺少 bookId');
  const snap = await store.load(profileId);
  const auth = { requestId, apiKey };

  let info = null;
  let progress = null;
  const errors = [];

  try {
    info = await wereadCall('/book/info', { bookId }, auth);
  } catch (err) {
    errors.push(`book_info: ${err.message}`);
  }

  try {
    const p = await wereadCall('/book/getprogress', { bookId }, auth);
    if (p?.book) {
      progress = {
        percent: p.book.progress ?? 0,
        recordReadingTime: p.book.recordReadingTime ?? 0,
        updateTime: p.book.updateTime ?? 0,
        finishTime: p.book.finishTime ?? null,
        isStartReading: p.book.isStartReading === 1,
      };
    }
  } catch (err) {
    errors.push(`progress: ${err.message}`);
  }

  // 书架里已有的信息作为兜底
  const shelfBook =
    (snap.shelf?.books || []).find((b) => String(b.bookId) === String(bookId)) || null;

  const myNotes = snap.notes?.[String(bookId)] || null;

  const title = info?.title || shelfBook?.title;
  const author = info?.author || shelfBook?.author;

  // 上游与书架都查不到，说明 bookId 无效
  if (!title) {
    throw new NotFoundError(`未找到书籍 ${bookId}，请确认 bookId 是否正确`);
  }

  let douban = null;
  if (title) {
    try {
      douban = await getRating(title, author, profileId);
    } catch {
      douban = null;
    }
  }

  return {
    bookId: String(bookId),
    title: info?.title || shelfBook?.title || '',
    author: info?.author || shelfBook?.author || '',
    translator: info?.translator || '',
    cover: info?.cover || shelfBook?.cover || '',
    intro: info?.intro || '',
    category: info?.category || shelfBook?.category || '',
    publisher: info?.publisher || '',
    publishTime: trimDate(info?.publishTime),
    isbn: info?.isbn || '',
    wordCount: info?.wordCount || 0,
    wereadRating: toTenPoint(info?.newRating),
    wereadRatingCount: info?.newRatingCount || 0,
    douban,
    progress,
    inShelf: !!shelfBook,
    myNotes: myNotes
      ? {
          highlights: myNotes.highlights?.length || 0,
          reviews: myNotes.reviews?.length || 0,
          bookmarks: myNotes.counts?.bookmark || 0,
        }
      : { highlights: 0, reviews: 0, bookmarks: 0 },
    warnings: errors,
  };
}

/** 批量豆瓣评分（按需、带缓存，前端分片调用） */
export async function batchDouban(items, { profileId } = {}) {
  if (!Array.isArray(items)) throw new ValidationError('items 必须是数组');
  const capped = items.slice(0, 30);
  const out = {};
  let i = 0;
  for (const it of capped) {
    if (!it?.title) continue;
    // 每 4 个让出一次事件循环，避免长任务阻塞
    if (i++ % 4 === 0) await sleep(0);
    try {
      out[it.bookId] = await getRating(it.title, it.author, profileId);
    } catch {
      out[it.bookId] = null;
    }
  }
  return { ratings: out };
}