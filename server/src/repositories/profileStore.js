import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { encrypt, decrypt, maskKey } from '../lib/secretBox.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

/**
 * 档案（Profile）= 一个微信读书身份 + 一份独立数据。
 * 这样多个用户可以在同一实例上各自接入，数据互不覆盖。
 */
let state = null; // { version, profiles: [ {id, name, hint, keyEnc, createdAt, lastUsedAt} ] }
let initPromise = null;

const newId = () => crypto.randomBytes(6).toString('hex');

export function profilePaths(id) {
  const dir = path.join(config.storage.profilesDir, id);
  return {
    dir,
    snapshot: path.join(dir, 'snapshot.json'),
    doubanCache: path.join(dir, 'douban-cache.json'),
  };
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 写档案索引。
 * 注意两点：
 *  1) 临时文件名必须唯一，否则并发写会互相踩踏（EPERM / ENOENT）
 *  2) 写操作串行化，避免 rename 覆盖
 */
let writeChain = Promise.resolve();

function writeState() {
  const task = () => {
    if (!state) return Promise.resolve();
    return (async () => {
      await fs.mkdir(config.storage.dir, { recursive: true });
      const tmp = `${config.storage.profiles}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 1), 'utf8');
      await fs.rename(tmp, config.storage.profiles);
    })();
  };
  const p = writeChain.then(task, task);
  writeChain = p.catch(() => {});
  return p;
}

/** 首次启动迁移：把旧版单用户数据转换成一个档案，老用户无需重新接入 */
async function migrateLegacyIfNeeded() {
  const hasLegacySnapshot = await fileExists(config.storage.legacySnapshot);
  const seedKey = config.weread.seedApiKey;
  if (!hasLegacySnapshot && !seedKey) return null;

  const id = newId();
  const p = profilePaths(id);
  await fs.mkdir(p.dir, { recursive: true });

  const entry = {
    id,
    name: '我的阅读',
    hint: seedKey ? maskKey(seedKey) : '',
    keyEnc: seedKey ? await encrypt(seedKey) : null,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };

  if (hasLegacySnapshot) {
    await fs.copyFile(config.storage.legacySnapshot, p.snapshot).catch(() => {});
    const hasCache = await fileExists(config.storage.legacyDoubanCache);
    if (hasCache) await fs.copyFile(config.storage.legacyDoubanCache, p.doubanCache).catch(() => {});
  }

  logger.info('profile_migrated_from_legacy', { profileId: id, hasSnapshot: hasLegacySnapshot });
  return { version: 1, profiles: [entry] };
}

export async function init() {
  if (state) return state;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const raw = await fs.readFile(config.storage.profiles, 'utf8');
      state = JSON.parse(raw);
      if (!Array.isArray(state.profiles)) state.profiles = [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const migrated = await migrateLegacyIfNeeded();
      state = migrated || { version: 1, profiles: [] };
      if (migrated) await writeState();
    }
    return state;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

/** 对外安全视图：绝不含 keyEnc */
export function listProfiles() {
  return (state?.profiles || [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      hint: p.hint || '',
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
      hasKey: !!p.keyEnc,
    }))
    .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
}

export function getProfile(id) {
  return (state?.profiles || []).find((p) => p.id === id) || null;
}

export async function getApiKey(id) {
  const p = getProfile(id);
  if (!p) throw new NotFoundError('档案不存在');
  if (!p.keyEnc) throw new ValidationError('该档案尚未绑定 API Key');
  return decrypt(p.keyEnc);
}

export async function createProfile({ name, apiKey }) {
  await init();
  const key = String(apiKey || '').trim();
  if (!key) throw new ValidationError('请填写微信读书 API Key');

  const id = newId();
  const cleanName = String(name || '').trim().slice(0, 20) || `读者 ${state.profiles.length + 1}`;
  const entry = {
    id,
    name: cleanName,
    hint: maskKey(key),
    keyEnc: await encrypt(key),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  state.profiles.push(entry);
  await writeState();
  await fs.mkdir(profilePaths(id).dir, { recursive: true });
  return { id: entry.id, name: entry.name, hint: entry.hint };
}

export async function updateProfile(id, { name, apiKey }) {
  const p = getProfile(id);
  if (!p) throw new NotFoundError('档案不存在');
  if (name !== undefined) p.name = String(name).trim().slice(0, 20) || p.name;
  if (apiKey !== undefined && String(apiKey).trim()) {
    const key = String(apiKey).trim();
    p.keyEnc = await encrypt(key);
    p.hint = maskKey(key);
  }
  await writeState();
  return { id: p.id, name: p.name, hint: p.hint };
}

export async function removeProfile(id) {
  const idx = (state?.profiles || []).findIndex((p) => p.id === id);
  if (idx < 0) throw new NotFoundError('档案不存在');
  state.profiles.splice(idx, 1);
  await writeState();
  await fs.rm(profilePaths(id).dir, { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

export async function touch(id) {
  const p = getProfile(id);
  if (!p) return;
  const now = Date.now();
  const last = p.lastUsedAt ? new Date(p.lastUsedAt).getTime() : 0;
  // 一分钟内不重复落盘，避免每个请求都写索引
  if (now - last < 60_000) return;
  p.lastUsedAt = new Date(now).toISOString();
  await writeState().catch(() => {});
}

/** 未指定档案时，默认用最近使用的一个 */
export function defaultProfileId() {
  const list = listProfiles();
  return list[0]?.id || null;
}

export function hasProfiles() {
  return (state?.profiles || []).length > 0;
}