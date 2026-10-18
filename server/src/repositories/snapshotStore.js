import fs from 'node:fs/promises';
import { profilePaths } from './profileStore.js';

/**
 * 快照存储（按档案隔离）：磁盘 JSON + 内存缓存。
 * 写入使用「临时文件 + 原子重命名」，避免进程中断产生半截文件。
 */
const memory = new Map(); // profileId -> snapshot
const loading = new Map();
const writeChains = new Map();

function emptySnapshot() {
  return {
    version: 1,
    syncedAt: null,
    quickSyncedAt: null,
    fullSyncedAt: null,
    readdata: null,
    shelf: null,
    notebooks: null,
    notes: {},
  };
}

export async function load(profileId) {
  if (!profileId) throw new Error('缺少 profileId');
  const cached = memory.get(profileId);
  if (cached) return cached;
  if (loading.has(profileId)) return loading.get(profileId);

  const task = (async () => {
    const { snapshot } = profilePaths(profileId);
    let snap;
    try {
      snap = { ...emptySnapshot(), ...JSON.parse(await fs.readFile(snapshot, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      snap = emptySnapshot();
    }
    memory.set(profileId, snap);
    return snap;
  })();

  loading.set(profileId, task);
  try {
    return await task;
  } finally {
    loading.delete(profileId);
  }
}

export async function save(profileId, next) {
  memory.set(profileId, next);
  const { dir, snapshot } = profilePaths(profileId);
  await fs.mkdir(dir, { recursive: true });
  // 临时文件名加随机后缀，避免并发写冲突
  const tmp = `${snapshot}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next), 'utf8');
  await fs.rename(tmp, snapshot);
  return next;
}

export async function patch(profileId, partial) {
  const cur = await load(profileId);
  return save(profileId, { ...cur, ...partial });
}

/** 每个档案独立的写队列，避免并发同步互相覆盖 */
export function enqueueWrite(profileId, fn) {
  const prev = writeChains.get(profileId) || Promise.resolve();
  const p = prev.then(fn, fn);
  writeChains.set(
    profileId,
    p.catch(() => {})
  );
  return p;
}

/** 档案删除后释放内存缓存 */
export function forget(profileId) {
  memory.delete(profileId);
  writeChains.delete(profileId);
}