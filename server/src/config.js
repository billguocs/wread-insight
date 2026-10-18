import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.resolve(APP_ROOT, '..', 'data');

/** 读取必填环境变量，缺失则启动即失败（避免运行时才暴露配置问题） */
function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `缺少环境变量 ${name}。请在 ${path.join(APP_ROOT, '.env')} 中配置，参考 .env.example`
    );
  }
  return v.trim();
}

/** 可选环境变量：不再强制，用户可在网页内完成接入 */
function optional(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`环境变量 ${name} 必须是整数，当前值: ${raw}`);
  return n;
}

export const config = {
  port: intEnv('PORT', 8787),
  env: process.env.NODE_ENV || 'development',

  weread: {
    gateway: process.env.WEREAD_GATEWAY || 'https://i.weread.qq.com/api/agent/gateway',
    // 可选：仅用于首次启动时自动迁移为默认档案，之后密钥由用户在网页内录入
    seedApiKey: optional('WEREAD_API_KEY'),
    skillVersion: process.env.WEREAD_SKILL_VERSION || '1.0.5',
    timeoutMs: intEnv('WEREAD_TIMEOUT_MS', 45000),
  },

  douban: {
    enabled: process.env.DOUBAN_ENABLED !== 'false',
    timeoutMs: intEnv('DOUBAN_TIMEOUT_MS', 15000),
    cacheTtlMs: intEnv('DOUBAN_CACHE_TTL_HOURS', 720) * 3600 * 1000,
    concurrency: intEnv('DOUBAN_CONCURRENCY', 2),
    minIntervalMs: intEnv('DOUBAN_MIN_INTERVAL_MS', 350),
  },

  storage: {
    dir: path.join(APP_ROOT, 'storage'),
    profiles: path.join(APP_ROOT, 'storage', 'profiles.json'),
    profilesDir: path.join(APP_ROOT, 'storage', 'profiles'),
    secretKeyFile: path.join(APP_ROOT, 'storage', '.secret'),
    // 旧版单用户文件，仅用于首次启动时迁移
    legacySnapshot: path.join(APP_ROOT, 'storage', 'snapshot.json'),
    legacyDoubanCache: path.join(APP_ROOT, 'storage', 'douban-cache.json'),
    legacyData: DATA_ROOT,
  },

  sync: {
    quickTtlMs: intEnv('QUICK_SYNC_TTL_MINUTES', 10) * 60 * 1000,
    fullTtlMs: intEnv('FULL_SYNC_TTL_HOURS', 12) * 3600 * 1000,
    monthlyWindow: intEnv('SYNC_MONTH_WINDOW', 24),
    weeklyWindow: intEnv('SYNC_WEEK_WINDOW', 12),
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export const APP_ROOT_DIR = APP_ROOT;