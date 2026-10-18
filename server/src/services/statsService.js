import { NotFoundError } from '../lib/errors.js';
import * as store from '../repositories/snapshotStore.js';

/** 把上游原始统计结构转换为前端友好的扁平结构 */
function num(v) {
  const n = Number.parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

function readStatMap(statArr) {
  const out = {};
  for (const s of statArr || []) out[s.stat] = { count: num(s.counts), text: s.counts };
  return out;
}

function yearRows(annually) {
  return Object.entries(annually || {})
    .map(([year, a]) => {
      const stat = readStatMap(a.readStat);
      const days = num(a.readDays);
      const seconds = num(a.totalReadTime);
      return {
        year: Number(year),
        seconds,
        hours: +(seconds / 3600).toFixed(1),
        days,
        booksRead: stat['读过']?.count || 0,
        booksDone: stat['读完']?.count || 0,
        notes: stat['笔记']?.count || 0,
        avgPerDay: days ? +(seconds / 3600 / days).toFixed(2) : 0,
        compare: typeof a.compare === 'number' ? a.compare : null,
      };
    })
    .sort((a, b) => a.year - b.year);
}

function monthRows(hist) {
  return Object.entries(hist || {})
    .map(([key, m]) => ({
      key,
      seconds: num(m.totalReadTime),
      days: num(m.readDays),
      hours: +(num(m.totalReadTime) / 3600).toFixed(1),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function weekRows(hist) {
  return Object.entries(hist || {})
    .map(([key, m]) => ({
      key,
      seconds: num(m.totalReadTime),
      days: num(m.readDays),
      hours: +(num(m.totalReadTime) / 3600).toFixed(1),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function timeOfDay(preferTime) {
  // 服务端从 6 点开始，依次到次日 5 点
  const arr = Array.isArray(preferTime) ? preferTime : [];
  return arr.map((sec, i) => ({ hour: (6 + i) % 24, seconds: num(sec) }));
}

export async function getOverview(profileId) {
  const snap = await store.load(profileId);
  if (!snap.readdata?.overall) throw new NotFoundError('暂无阅读统计数据，请先触发同步');

  const ov = snap.readdata.overall;
  const stat = readStatMap(ov.readStat);
  const totalSeconds = num(ov.totalReadTime);
  const readDays = num(ov.readDays);
  const registTs = num(ov.registTime);
  const dayCount = registTs ? Math.max((Date.now() / 1000 - registTs) / 86400, 1) : 1;

  const yrs = yearRows(snap.readdata.annually);
  const activeYears = yrs.filter((y) => y.seconds > 0);

  return {
    registDate: registTs ? new Date(registTs * 1000).toISOString().slice(0, 10) : null,
    totalSeconds,
    totalHours: +(totalSeconds / 3600).toFixed(1),
    readDays,
    avgPerReadDay: readDays ? +(totalSeconds / 3600 / readDays).toFixed(2) : 0,
    avgPerNaturalDay: +(totalSeconds / 3600 / dayCount).toFixed(2),
    booksRead: stat['读过']?.count || 0,
    booksDone: stat['读完']?.count || 0,
    notes: stat['笔记']?.count || 0,
    activeYearCount: activeYears.length,
    firstYear: activeYears[0]?.year || null,
    lastYear: activeYears.at(-1)?.year || null,
    currentMonth: {
      seconds: num(snap.readdata.monthly?.totalReadTime),
      days: num(snap.readdata.monthly?.readDays),
      compare: typeof snap.readdata.monthly?.compare === 'number' ? snap.readdata.monthly.compare : null,
    },
    currentWeek: {
      seconds: num(snap.readdata.weekly?.totalReadTime),
      days: num(snap.readdata.weekly?.readDays),
    },
    syncedAt: snap.syncedAt,
  };
}

export async function getTrend(profileId) {
  const snap = await store.load(profileId);
  if (!snap.readdata) throw new NotFoundError('暂无统计数据');
  return {
    yearly: yearRows(snap.readdata.annually),
    monthly: monthRows(snap.readdata.monthly_hist),
    weekly: weekRows(snap.readdata.weekly_hist),
  };
}

export async function getProfile(profileId) {
  const snap = await store.load(profileId);
  const ov = snap.readdata?.overall;
  if (!ov) throw new NotFoundError('暂无统计数据');

  return {
    categories: (ov.preferCategory || []).map((c) => ({
      title: c.categoryTitle,
      parent: c.parentCategoryTitle || '',
      seconds: num(c.readingTime),
      hours: +(num(c.readingTime) / 3600).toFixed(1),
      count: num(c.readingCount),
    })),
    timeOfDay: timeOfDay(ov.preferTime),
    preferTimeWord: ov.preferTimeWord || '',
    preferCategoryWord: ov.preferCategoryWord || '',
    authors: (ov.preferAuthor || []).map((a) => ({
      name: a.name,
      count: num(a.count),
      readTime: a.readTime || '',
    })),
    authorCount: num(ov.authorCount),
    publishers: (ov.preferPublisher || []).map((p) => ({ name: p.name, count: num(p.count) })),
    topBooks: (ov.readLongest || []).map((b) => ({
      bookId: b.book?.bookId || b.albumInfo?.albumId || '',
      title: b.book?.title || b.albumInfo?.name || '',
      author: b.book?.author || b.albumInfo?.authorName || '',
      cover: b.book?.cover || b.albumInfo?.cover || '',
      seconds: num(b.readTime),
      hours: +(num(b.readTime) / 3600).toFixed(1),
      isAlbum: !!b.albumInfo,
      tags: b.tags || [],
    })),
  };
}

export async function getReadingDaysHeatmap(profileId) {
  const snap = await store.load(profileId);
  const ann = snap.readdata?.annually || {};
  // 优先使用年度每日明细（若上游返回），否则用年度累计做年度级热力
  const days = [];
  for (const [year, a] of Object.entries(ann)) {
    if (!a.dailyReadTimes) continue;
    for (const [ts, sec] of Object.entries(a.dailyReadTimes)) {
      const n = num(sec);
      if (n > 0) {
        days.push({ date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), seconds: n });
      }
    }
  }
  return { days, granularity: days.length ? 'day' : 'none' };
}