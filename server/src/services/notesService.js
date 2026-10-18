import * as store from '../repositories/snapshotStore.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function bookList(snapshot) {
  const notes = snapshot.notes || {};
  return Object.values(notes)
    .map((n) => ({
      bookId: n.bookId,
      title: n.title,
      author: n.author,
      cover: n.cover,
      highlights: (n.highlights || []).length,
      reviews: (n.reviews || []).length,
      bookmarks: n.counts?.bookmark || 0,
      total:
        (n.highlights || []).length + (n.reviews || []).length + (n.counts?.bookmark || 0),
      progress: n.readingProgress ?? null,
      markedStatus: n.markedStatus ?? null,
      lastNoteTime: Math.max(
        0,
        ...(n.highlights || []).map((h) => h.createTime || 0),
        ...(n.reviews || []).map((r) => r.createTime || 0)
      ),
    }))
    .sort((a, b) => b.total - a.total);
}

export async function getBooks({ q = '', sort = 'total' } = {}, profileId) {
  const snap = await store.load(profileId);
  if (!snap.notes || Object.keys(snap.notes).length === 0) {
    throw new NotFoundError('暂无笔记数据，请执行「全量同步」');
  }
  let list = bookList(snap);
  if (q.trim()) {
    const kw = q.trim().toLowerCase();
    list = list.filter(
      (b) => b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw)
    );
  }
  if (sort === 'recent') list.sort((a, b) => b.lastNoteTime - a.lastNoteTime);
  else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));

  const totalHl = list.reduce((s, b) => s + b.highlights, 0);
  const totalRev = list.reduce((s, b) => s + b.reviews, 0);
  const totalBm = list.reduce((s, b) => s + b.bookmarks, 0);
  return {
    total: list.length,
    stats: {
      books: list.length,
      highlights: totalHl,
      reviews: totalRev,
      bookmarks: totalBm,
      all: totalHl + totalRev + totalBm,
    },
    books: list,
  };
}

/** 从章节标题解析层级序号，如 "5.1 垃圾回收" -> [5,1]，用于无 chapterIdx 时兜底排序 */
function chapterOrder(title, idx) {
  if (typeof idx === 'number' && idx > 0) return [idx];
  const m = String(title || '').match(/^\s*(\d+(?:[.．]\d+)*)/);
  if (!m) return [Number.MAX_SAFE_INTEGER];
  return m[1].split(/[.．]/).map((x) => Number.parseInt(x, 10) || 0);
}

function cmpOrder(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** 单本笔记：按章节分组 + 想法列表 */
export async function getBookNotes(bookId, profileId) {
  const snap = await store.load(profileId);
  const n = snap.notes?.[String(bookId)];
  if (!n) throw new NotFoundError('该书没有笔记');

  const groups = new Map();
  for (const h of n.highlights || []) {
    const key = h.chapterTitle || '未分章';
    if (!groups.has(key)) {
      groups.set(key, { key, idx: h.chapterIdx, items: [] });
    }
    groups.get(key).items.push({
      ...h,
      date: fmtDate(h.createTime),
      rangeStart: String(h.range || '').split('-')[0] || '',
      rangeEnd: String(h.range || '').split('-')[1] || '',
    });
  }

  const chapters = [...groups.values()]
    .sort((a, b) => cmpOrder(chapterOrder(a.key, a.idx), chapterOrder(b.key, b.idx)))
    .map((g) => ({
      title: g.key,
      items: g.items.sort(
        (x, y) => (Number(x.rangeStart) || 0) - (Number(y.rangeStart) || 0)
      ),
    }));

  const reviews = (n.reviews || [])
    .map((r) => ({
      ...r,
      date: fmtDate(r.createTime),
      kind: r.isFinish ? '书评' : r.chapterName ? '章节点评' : '想法',
    }))
    .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));

  return {
    bookId: n.bookId,
    title: n.title,
    author: n.author,
    cover: n.cover,
    counts: {
      highlights: (n.highlights || []).length,
      reviews: (n.reviews || []).length,
      bookmarks: n.counts?.bookmark || 0,
    },
    progress: n.readingProgress ?? null,
    chapters,
    reviews,
  };
}

/** 全局搜索划线与想法 */
export async function searchNotes({ q = '', type = 'all', limit = 80 } = {}, profileId) {
  if (!q.trim()) return { query: '', total: 0, hits: [] };
  const snap = await store.load(profileId);
  const kw = q.trim().toLowerCase();
  const hits = [];

  for (const n of Object.values(snap.notes || {})) {
    if (type !== 'review') {
      for (const h of n.highlights || []) {
        if ((h.markText || '').toLowerCase().includes(kw)) {
          hits.push({
            kind: 'highlight',
            bookId: n.bookId,
            book: n.title,
            author: n.author,
            chapter: h.chapterTitle,
            text: h.markText,
            date: fmtDate(h.createTime),
          });
        }
      }
    }
    if (type !== 'highlight') {
      for (const r of n.reviews || []) {
        if ((r.content || '').toLowerCase().includes(kw)) {
          hits.push({
            kind: 'review',
            bookId: n.bookId,
            book: n.title,
            author: n.author,
            chapter: r.chapterName,
            text: r.content,
            date: fmtDate(r.createTime),
          });
        }
      }
    }
  }

  hits.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { query: q.trim(), total: hits.length, hits: hits.slice(0, limit) };
}

// ---------- 导出 ----------
function toMarkdown(bookEntries) {
  const lines = ['# 微信读书 · 笔记导出', '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  let totalHl = 0;
  let totalRev = 0;
  for (const b of bookEntries) {
    totalHl += b.highlights.length;
    totalRev += b.reviews.length;
    lines.push(`## ${b.title}${b.author ? ` · ${b.author}` : ''}`, '');
    lines.push(`> 划线 ${b.highlights.length} 条，想法 ${b.reviews.length} 条`, '');

    const groups = new Map();
    for (const h of b.highlights) {
      const k = h.chapterTitle || '未分章';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    }
    for (const [chapter, items] of groups) {
      lines.push(`### ${chapter}`, '');
      for (const h of items) {
        lines.push(`> ${(h.markText || '').replace(/\n/g, ' ')}`);
        lines.push(`> —— ${fmtDate(h.createTime)}`, '');
      }
    }
    if (b.reviews.length) {
      lines.push('### 想法与点评', '');
      for (const r of b.reviews) {
        const tag = r.isFinish ? '书评' : r.chapterName ? '章节点评' : '想法';
        lines.push(`- **[${tag}]** ${fmtDate(r.createTime)}：${(r.content || '').replace(/\n/g, ' ')}`);
      }
      lines.push('');
    }
    lines.push('---', '');
  }
  lines.splice(4, 0, `共 ${bookEntries.length} 本书，划线 ${totalHl} 条，想法 ${totalRev} 条`, '');
  return lines.join('\n');
}

function csvEscape(v) {
  const s = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${s}"`;
}

function toCsv(bookEntries) {
  const rows = [['类型', '书名', '作者', '章节', '内容', '日期'].map(csvEscape).join(',')];
  for (const b of bookEntries) {
    for (const h of b.highlights) {
      rows.push(
        [
          '划线',
          b.title,
          b.author,
          h.chapterTitle || '',
          h.markText || '',
          fmtDate(h.createTime),
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    for (const r of b.reviews) {
      rows.push(
        [
          r.isFinish ? '书评' : r.chapterName ? '章节点评' : '想法',
          b.title,
          b.author,
          r.chapterName || '',
          r.content || '',
          fmtDate(r.createTime),
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }
  return '\uFEFF' + rows.join('\r\n');
}

export async function exportNotes({ format = 'md', bookId = null } = {}, profileId) {
  const snap = await store.load(profileId);
  const all = Object.values(snap.notes || {});
  if (all.length === 0) throw new NotFoundError('暂无笔记可导出');

  let entries = all;
  let baseName = 'weread-notes-all';
  if (bookId) {
    const one = snap.notes[String(bookId)];
    if (!one) throw new NotFoundError('该书没有笔记');
    entries = [one];
    baseName = `weread-notes-${(one.title || bookId).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}`;
  }

  entries.sort(
    (a, b) =>
      b.highlights.length + b.reviews.length - (a.highlights.length + a.reviews.length)
  );

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    return {
      filename: `${baseName}-${stamp}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(
        entries.map((e) => ({
          bookId: e.bookId,
          title: e.title,
          author: e.author,
          highlights: (e.highlights || []).map((h) => ({
            chapter: h.chapterTitle,
            text: h.markText,
            date: fmtDate(h.createTime),
          })),
          reviews: (e.reviews || []).map((r) => ({
            kind: r.isFinish ? '书评' : r.chapterName ? '章节点评' : '想法',
            chapter: r.chapterName,
            content: r.content,
            star: r.star,
            date: fmtDate(r.createTime),
          })),
        })),
        null,
        2
      ),
    };
  }
  if (format === 'csv') {
    return {
      filename: `${baseName}-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(entries),
    };
  }
  if (format === 'md') {
    return {
      filename: `${baseName}-${stamp}.md`,
      contentType: 'text/markdown; charset=utf-8',
      body: toMarkdown(entries),
    };
  }
  throw new ValidationError(`不支持的导出格式: ${format}`);
}