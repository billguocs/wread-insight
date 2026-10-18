import { Router } from 'express';
import { asyncHandler } from '../middleware/context.js';
import { requireApiKey, requireProfileCtx } from '../middleware/profileContext.js';
import * as shelf from '../services/shelfService.js';
import * as stats from '../services/statsService.js';
import * as notes from '../services/notesService.js';
import * as discover from '../services/discoverService.js';
import * as sync from '../services/syncService.js';
import * as store from '../repositories/snapshotStore.js';
import * as profiles from '../repositories/profileStore.js';
import { cacheStats, forgetCache } from '../integrations/doubanClient.js';
import { probeApiKey } from '../integrations/wereadClient.js';
import { config } from '../config.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';

export const api = Router();

// ---------- 健康检查 ----------
api.get('/health', (req, res) => res.json({ ok: true, env: config.env, ts: Date.now() }));

api.get(
  '/ready',
  asyncHandler(async (req, res) => {
    if (!req.ctx?.profileId) return res.json({ ready: true, hasProfile: false, hasData: false });
    const snap = await store.load(req.ctx.profileId);
    res.json({ ready: true, hasProfile: true, hasData: !!snap.syncedAt, syncedAt: snap.syncedAt });
  })
);

/** 前端启动引导：判断是否已接入，返回档案列表 */
api.get(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    const list = profiles.listProfiles();
    const active = req.ctx?.profileId || null;
    const snap = active ? await store.load(active) : null;
    res.json({
      needsSetup: list.length === 0,
      profiles: list,
      activeProfileId: active,
      hasKey: !!req.ctx?.apiKey,
      hasData: !!snap?.syncedAt,
      appName: '细读',
    });
  })
);

// ---------- 档案管理（接入 / 切换 / 解绑） ----------
api.get(
  '/profiles',
  asyncHandler(async (req, res) => {
    res.json({ profiles: profiles.listProfiles(), activeProfileId: req.ctx?.profileId || null });
  })
);

/** 仅校验 Key 是否可用，不落库 */
api.post(
  '/profiles/probe',
  asyncHandler(async (req, res) => {
    const key = String(req.body?.apiKey || '').trim();
    if (!key) throw new ValidationError('请填写 API Key');
    const result = await probeApiKey(key, { requestId: req.id });
    res.json(result);
  })
);

/** 创建档案（= 接入一个新账号） */
api.post(
  '/profiles',
  asyncHandler(async (req, res) => {
    const { name, apiKey } = req.body || {};
    const key = String(apiKey || '').trim();
    if (!key) throw new ValidationError('请填写 API Key');

    const probe = await probeApiKey(key, { requestId: req.id });
    if (!probe.ok) {
      throw new ValidationError(probe.message || 'API Key 校验未通过，请确认后重试');
    }

    const created = await profiles.createProfile({ name, apiKey: key });
    // 新档案立即触发一次全量同步（后台跑，不阻塞响应）
    sync.startSync({ profileId: created.id, apiKey: key, requestId: req.id }, 'full');

    res.status(201).json({ ...created, syncStarted: true, probe });
  })
);

api.patch(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const { name, apiKey } = req.body || {};
    if (apiKey) {
      const probe = await probeApiKey(String(apiKey).trim(), { requestId: req.id });
      if (!probe.ok) throw new ValidationError(probe.message || 'API Key 校验未通过');
    }
    res.json(await profiles.updateProfile(req.params.id, { name, apiKey }));
  })
);

api.delete(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (sync.isRunning(id)) throw new ValidationError('该档案正在同步，请稍后再删除');
    await profiles.removeProfile(id);
    store.forget(id);
    sync.forgetState(id);
    forgetCache(id);
    res.json({ ok: true, remaining: profiles.listProfiles() });
  })
);

// ---------- 同步 ----------
api.get(
  '/sync/status',
  asyncHandler(async (req, res) => {
    res.json(sync.getStatus(req.ctx?.profileId));
  })
);

api.post(
  '/sync',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    const mode = req.query.mode === 'full' ? 'full' : 'quick';
    if (!req.ctx.apiKey) throw new ValidationError('该档案尚未绑定 API Key，无法同步');
    const r = sync.startSync(req.ctx, mode);
    res.status(r.started ? 202 : 409).json(r);
  })
);

api.get(
  '/meta',
  asyncHandler(async (req, res) => {
    if (!req.ctx?.profileId) {
      return res.json({ syncedAt: null, counts: {}, douban: { total: 0, matched: 0 } });
    }
    const snap = await store.load(req.ctx.profileId);
    const ds = await cacheStats(req.ctx.profileId);
    res.json({
      profile: { id: req.ctx.profileId, name: req.profile?.name || '', hint: req.profile?.hint || '' },
      syncedAt: snap.syncedAt,
      quickSyncedAt: snap.quickSyncedAt,
      fullSyncedAt: snap.fullSyncedAt,
      staleness: sync.staleness(snap),
      syncStatus: sync.getStatus(req.ctx.profileId),
      douban: { ...ds, enabled: config.douban.enabled },
      counts: {
        shelfBooks: (snap.shelf?.books || []).length,
        shelfAlbums: (snap.shelf?.albums || []).length,
        notebookBooks: (snap.notebooks?.books || []).length,
        noteBooks: Object.keys(snap.notes || {}).length,
      },
    });
  })
);

// ---------- 书架 ----------
api.get(
  '/shelf',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    const { q = '', filter = 'all', sort = 'recent', limit = 120, offset = 0 } = req.query;
    res.json(
      await shelf.listShelf(
        {
          q: String(q),
          filter: String(filter),
          sort: String(sort),
          limit: Math.min(Number(limit) || 120, 500),
          offset: Number(offset) || 0,
        },
        req.ctx.profileId
      )
    );
  })
);

api.get(
  '/books/:bookId',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    res.json(await shelf.getBookDetail(req.params.bookId, req.ctx));
  })
);

api.post(
  '/douban/batch',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    res.json(await shelf.batchDouban(req.body?.items, { profileId: req.ctx.profileId }));
  })
);

// ---------- 数据 ----------
api.get(
  '/stats/overview',
  requireProfileCtx,
  asyncHandler(async (req, res) => res.json(await stats.getOverview(req.ctx.profileId)))
);
api.get(
  '/stats/trend',
  requireProfileCtx,
  asyncHandler(async (req, res) => res.json(await stats.getTrend(req.ctx.profileId)))
);
api.get(
  '/stats/profile',
  requireProfileCtx,
  asyncHandler(async (req, res) => res.json(await stats.getProfile(req.ctx.profileId)))
);

// ---------- 笔记 ----------
api.get(
  '/notes/books',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    const { q = '', sort = 'total' } = req.query;
    res.json(await notes.getBooks({ q: String(q), sort: String(sort) }, req.ctx.profileId));
  })
);

api.get(
  '/notes/search',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    const { q = '', type = 'all', limit = 80 } = req.query;
    res.json(
      await notes.searchNotes(
        { q: String(q), type: String(type), limit: Number(limit) || 80 },
        req.ctx.profileId
      )
    );
  })
);

api.get(
  '/notes/export',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    const { format = 'md', bookId } = req.query;
    const r = await notes.exportNotes(
      { format: String(format), bookId: bookId || null },
      req.ctx.profileId
    );
    res.setHeader('Content-Type', r.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`
    );
    res.send(r.body);
  })
);

api.get(
  '/notes/:bookId',
  requireProfileCtx,
  asyncHandler(async (req, res) => {
    res.json(await notes.getBookNotes(req.params.bookId, req.ctx.profileId));
  })
);

// ---------- 发现 ----------
api.get(
  '/discover/recommend',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { count = 12, offset = 0, douban = '0' } = req.query;
    const r = await discover.getRecommend(
      { count: Math.min(Number(count) || 12, 30), offset: Number(offset) || 0 },
      req.ctx
    );
    res.json(
      douban === '0'
        ? r
        : { ...r, books: await discover.enrichWithDouban(r.books, req.ctx.profileId) }
    );
  })
);

api.get(
  '/discover/search',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { q = '', scope = 10, count = 15, offset = 0, douban = '0' } = req.query;
    const r = await discover.searchStore(
      {
        q: String(q),
        scope: Number(scope) || 10,
        count: Math.min(Number(count) || 15, 30),
        offset: Number(offset) || 0,
      },
      req.ctx
    );
    if (douban === '0') return res.json(r);
    const groups = [];
    for (const g of r.groups) {
      groups.push({ ...g, books: await discover.enrichWithDouban(g.books, req.ctx.profileId) });
    }
    res.json({ ...r, groups });
  })
);

api.get(
  '/discover/similar',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const { bookId, count = 12 } = req.query;
    if (!bookId) throw new NotFoundError('缺少 bookId');
    res.json(
      await discover.getSimilar(
        { bookId: String(bookId), count: Number(count) || 12 },
        req.ctx
      )
    );
  })
);