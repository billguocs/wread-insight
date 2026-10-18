import fs from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { createLimiter } from './wereadClient.js';
import { profilePaths } from '../repositories/profileStore.js';

/**
 * 豆瓣评分客户端（无官方 API，采用搜索建议 + 详情页解析）。
 * 策略：
 *  - 结果按档案隔离缓存到磁盘（评分变动极慢，TTL 默认 30 天）
 *  - 全局串行限速，避免触发风控
 *  - 任何失败都静默降级为 null，绝不阻塞主流程
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const limit = createLimiter(config.douban.concurrency);
const caches = new Map(); // profileId -> cache 对象
const dirty = new Set();
const flushTimers = new Map();

async function loadCache(profileId) {
  if (caches.has(profileId)) return caches.get(profileId);
  let data = {};
  try {
    const { doubanCache } = profilePaths(profileId);
    data = JSON.parse(await fs.readFile(doubanCache, 'utf8'));
  } catch {
    data = {};
  }
  caches.set(profileId, data);
  return data;
}

function scheduleFlush(profileId) {
  if (flushTimers.has(profileId)) return;
  const timer = setTimeout(async () => {
    flushTimers.delete(profileId);
    if (!dirty.has(profileId)) return;
    dirty.delete(profileId);
    try {
      const { dir, doubanCache } = profilePaths(profileId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(doubanCache, JSON.stringify(caches.get(profileId) || {}), 'utf8');
    } catch (err) {
      logger.warn('douban_cache_flush_failed', { error: err.message });
    }
  }, 2000);
}

async function fetchText(url, accept = 'application/json,text/html') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.douban.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: accept,
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化标题：去括号内容、套装/全集等修饰、标点与空白 */
function normalizeTitle(s) {
  return String(s || '')
    .replace(/[（(\[【].*?[）)\]】]/g, '')
    .replace(/(套装|全集|全\d+册|上下册|精装|典藏|修订版|增订版|纪念版|第\d+版)/g, '')
    .replace(/[·•・:：,，.。!！?？'"“”‘’\-—_\s]/g, '')
    .toLowerCase();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  // 简易二元组重合度
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return (2 * hit) / (ga.size + gb.size);
}

function cleanAuthor(s) {
  return String(s || '')
    .replace(/[\[\]［］]/g, '')
    .replace(/(著|编著|主编|译|等)/g, '')
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

async function rateLimited(fn) {
  const now = Date.now();
  const wait = Math.max(0, config.douban.minIntervalMs - (now - lastRequestAt));
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return limit(fn);
}

/** 生成搜索候选：原始书名 → 去括号 → 去修饰词。豆瓣对含括号的标题常返回 0 结果。 */
function titleCandidates(title) {
  const raw = String(title || '').trim();
  const noBracket = raw.replace(/[（(\[【].*?[）)\]】]/g, '').trim();
  const stripped = noBracket
    .replace(/(套装|全集|全\d+册|上下册|精装|典藏|修订版|增订版|纪念版|第\d+版|新版)/g, '')
    .trim();
  const out = [];
  for (const c of [raw, noBracket, stripped]) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

async function suggestFor(query) {
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  const raw = await rateLimited(() => fetchText(url));
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function lookupUncached(title, author) {
  const q = String(title || '').trim();
  if (!q) return null;

  // 逐个候选查询，直到拿到非空结果
  let list = [];
  for (const cand of titleCandidates(title)) {
    // eslint-disable-next-line no-await-in-loop
    list = await suggestFor(cand);
    if (list.length) break;
  }
  if (list.length === 0) return { matched: false, title: q };

  const books = list.filter((x) => x.type === 'b' || x.url?.includes('/subject/'));
  if (books.length === 0) return null;

  const nt = normalizeTitle(title);
  const na = cleanAuthor(author);
  let best = null;
  let bestScore = 0;
  for (const item of books) {
    const sim = similarity(nt, normalizeTitle(item.title));
    let score = sim;
    if (na && item.author_name) {
      const cand = cleanAuthor(item.author_name);
      if (cand.includes(na) || na.includes(cand.split(/[\/、,，]/)[0])) score += 0.35;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (!best || bestScore < 0.6) return { matched: false, title: q };

  const page = await rateLimited(() => fetchText(`https://book.douban.com/subject/${best.id}/`));
  const rating = page.match(/property="v:average">\s*([\d.]+)/);
  const votes = page.match(/property="v:votes">\s*(\d+)/);
  const cover = page.match(/<img[^>]+src="([^"]+)"[^>]*rel="v:photo"/);

  const r = rating ? Number.parseFloat(rating[1]) : null;
  if (!r) return { matched: false, title: q };

  return {
    matched: true,
    doubanId: best.id,
    title: best.title,
    author: best.author_name || '',
    rating: r,
    votes: votes ? Number.parseInt(votes[1], 10) : 0,
    url: `https://book.douban.com/subject/${best.id}/`,
    cover: cover ? cover[1] : null,
    score: Number(bestScore.toFixed(2)),
    fetchedAt: new Date().toISOString(),
  };
}

/** 单本查询，带缓存
 *  缓存策略：
 *   - 命中：按长 TTL 缓存
 *   - 确认无匹配（matched:false）：按短 TTL 缓存，避免反复打空
 *   - 抓取失败（null）：绝不缓存，下次重试
 */
const NEGATIVE_TTL_MS = 6 * 3600 * 1000;

export async function getRating(title, author, profileId) {
  if (!config.douban.enabled || !profileId) return null;
  const c = await loadCache(profileId);
  const key = `${normalizeTitle(title)}|${cleanAuthor(author)}`;

  const hit = c[key];
  const hitData = hit?.data;
  if (hitData) {
    const ttl = hitData.matched ? config.douban.cacheTtlMs : NEGATIVE_TTL_MS;
    if (Date.now() - new Date(hit.cachedAt).getTime() < ttl) return hitData;
  }

  // 失败重试一次（豆瓣偶发限流）
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await lookupUncached(title, author);
      if (data) {
        c[key] = { cachedAt: new Date().toISOString(), data };
        dirty.add(profileId);
        scheduleFlush(profileId);
      }
      return data;
    } catch (err) {
      if (attempt === 1) {
        logger.warn('douban_lookup_failed', { title, error: err.message });
        return hitData || null;
      }
      await sleep(900);
    }
  }
  return hitData || null;
}

export async function batchRatings(items, profileId) {
  const out = {};
  for (const it of items) {
    // 顺序执行，内部已限速
    // eslint-disable-next-line no-await-in-loop
    out[it.bookId] = await getRating(it.title, it.author, profileId);
  }
  return out;
}

export async function cacheStats(profileId) {
  if (!profileId) return { total: 0, matched: 0 };
  const c = await loadCache(profileId);
  const keys = Object.keys(c);
  const matched = keys.filter((k) => c[k]?.data?.matched).length;
  return { total: keys.length, matched };
}

/** 档案删除后释放内存缓存与待写定时器 */
export function forgetCache(profileId) {
  caches.delete(profileId);
  dirty.delete(profileId);
  const t = flushTimers.get(profileId);
  if (t) clearTimeout(t);
  flushTimers.delete(profileId);
}