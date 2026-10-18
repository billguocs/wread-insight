import { wereadCall } from '../integrations/wereadClient.js';
import { getRating } from '../integrations/doubanClient.js';
import { ValidationError } from '../lib/errors.js';

/** 统一 10 分制：search 返回 93，info/recommend 可能返回 910 */
function toTenPoint(v) {
  const n = Number(v);
  if (!n) return null;
  return +(n > 100 ? n / 100 : n / 10).toFixed(1);
}

/** 归一化上游书籍字段（search / recommend 结构略有差异） */
function normalizeBook(raw) {
  const b = raw.bookInfo || raw.book || raw;
  return {
    bookId: String(b.bookId || ''),
    title: b.title || '',
    author: b.author || '',
    cover: b.cover || '',
    intro: b.intro || '',
    category: b.category || '',
    publisher: b.publisher || '',
    wereadRating: toTenPoint(b.newRating),
    wereadRatingCount: b.newRatingCount || 0,
    ratingLabel: b.newRatingDetail?.title || '',
    readingCount: raw.readingCount ?? b.readingCount ?? 0,
    reason: raw.reason || '',
    price: b.price ?? null,
    payType: b.payType ?? null,
    soldout: b.soldout === 1,
  };
}

export async function getRecommend({ count = 12, offset = 0 } = {}, { requestId, apiKey } = {}) {
  const r = await wereadCall(
    '/book/recommend',
    { count, maxIdx: offset },
    { requestId, apiKey }
  );
  return {
    books: (r.books || []).map(normalizeBook).filter((b) => b.bookId),
    hasMore: (r.books || []).length >= count,
  };
}

export async function searchStore({ q, scope = 10, count = 15, offset = 0 }, { requestId, apiKey } = {}) {
  if (!q || !q.trim()) throw new ValidationError('缺少搜索关键词 keyword');
  const r = await wereadCall(
    '/store/search',
    { keyword: q.trim(), scope, maxIdx: offset, count },
    { requestId, apiKey }
  );

  // 上游可能把每本书各返回成一个同名分组，这里按 scope 合并，避免前端出现重复标题栏
  const merged = new Map();
  for (const g of r.results || []) {
    const key = g.scope ?? g.title ?? 'other';
    if (!merged.has(key)) {
      merged.set(key, {
        title: g.title || '',
        scope: g.scope,
        total: g.scopeCount || 0,
        books: [],
      });
    }
    const bucket = merged.get(key);
    bucket.total = Math.max(bucket.total, g.scopeCount || 0);
    for (const b of g.books || []) {
      bucket.books.push({ ...normalizeBook(b), searchIdx: b.searchIdx ?? null });
    }
  }

  const groups = [...merged.values()].map((g) => ({
    ...g,
    books: g.books.filter((b) => b.bookId),
  }));

  return { query: q.trim(), hasMore: r.hasMore === 1, groups };
}

export async function getSimilar({ bookId, count = 12, offset = 0 } = {}, { requestId, apiKey } = {}) {
  if (!bookId) throw new ValidationError('缺少 bookId');
  // 注意：maxIdx 必须显式传（哪怕 0），否则上游会返回 errcode -2003「请求 body 不能为空」
  const r = await wereadCall(
    '/book/similar',
    { bookId, count, maxIdx: Number(offset) || 0 },
    { requestId, apiKey }
  );
  const bs = r.booksimilar?.books || [];
  return {
    sessionId: r.booksimilar?.sessionId || '',
    books: bs
      .map((x) => {
        // 相似推荐结构为 { idx, book: { bookInfo } }，需要多剥一层
        const info = x.book?.bookInfo || x.book || x;
        return { ...normalizeBook(info), idx: x.idx ?? null };
      })
      .filter((b) => b.bookId),
  };
}

/** 为推荐/搜索结果补豆瓣评分（最多 12 个，带缓存） */
export async function enrichWithDouban(books, profileId) {
  const out = [];
  for (const b of books.slice(0, 12)) {
    let douban = null;
    try {
      douban = await getRating(b.title, b.author, profileId);
    } catch {
      douban = null;
    }
    out.push({ ...b, douban });
  }
  return out.concat(books.slice(12));
}