/**
 * 用已有的 Python 采集结果预填「默认档案」的快照，避免首次启动等待全量同步。
 * 用法：node server/scripts/seed.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import * as profiles from '../src/repositories/profileStore.js';
import { profilePaths } from '../src/repositories/profileStore.js';

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`  跳过（不存在）: ${path.basename(file)}`);
      return fallback;
    }
    throw err;
  }
}

const dir = config.storage.legacyData;
console.log('从已有采集数据构建快照...');
console.log('  来源目录:', dir);

const readdata = await readJson(path.join(dir, 'readdata.json'));
const shelf = await readJson(path.join(dir, 'shelf.json'));
const notebooks = await readJson(path.join(dir, 'notebooks.json'));
const notes = await readJson(path.join(dir, 'notes_full.json'), {});

if (!readdata || !shelf) {
  console.error('缺少 readdata.json 或 shelf.json，无法生成快照。请先运行 scripts/collect.py');
  process.exit(1);
}

const nbBooks = new Map((notebooks?.books || []).map((b) => [String(b.bookId), b]));
for (const [bid, n] of Object.entries(notes)) {
  const meta = nbBooks.get(bid);
  if (!n.cover && meta?.book?.cover) n.cover = meta.book.cover;
}

// 确保存在默认档案
await profiles.init();
let id = profiles.defaultProfileId();
if (!id) {
  if (!config.weread.seedApiKey) {
    console.error('尚无档案且未配置 WEREAD_API_KEY，无法创建默认档案。请先在网页内接入账号。');
    process.exit(1);
  }
  const created = await profiles.createProfile({ name: '我的阅读', apiKey: config.weread.seedApiKey });
  id = created.id;
  console.log('  已创建档案:', created.name, created.hint);
}

const now = new Date().toISOString();
const snapshot = {
  version: 1,
  syncedAt: now,
  quickSyncedAt: now,
  fullSyncedAt: now,
  readdata,
  shelf,
  notebooks,
  notes,
};

const p = profilePaths(id);
await fs.mkdir(p.dir, { recursive: true });
await fs.writeFile(p.snapshot, JSON.stringify(snapshot), 'utf8');

const hl = Object.values(notes).reduce((s, n) => s + (n.highlights || []).length, 0);
const rev = Object.values(notes).reduce((s, n) => s + (n.reviews || []).length, 0);

console.log('完成 ->', p.snapshot);
console.log(
  `  书架 ${(shelf.books || []).length} 本 + ${(shelf.albums || []).length} 专辑 | 有笔记 ${Object.keys(notes).length} 本 | 划线 ${hl} 条 | 想法 ${rev} 条`
);