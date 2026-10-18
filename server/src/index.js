import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config, APP_ROOT_DIR } from './config.js';
import { logger } from './lib/logger.js';
import { requestContext, errorHandler, notFoundHandler } from './middleware/context.js';
import { resolveProfile } from './middleware/profileContext.js';
import { api } from './routes/api.js';
import * as store from './repositories/snapshotStore.js';
import * as profiles from './repositories/profileStore.js';
import { ensureFresh } from './services/syncService.js';

const app = express();

/** 同源判断：静态资源带 crossorigin 属性时浏览器会发送 Origin，需放行同源 */
function isSameOrigin(origin) {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    return (
      (host === '127.0.0.1' || host === 'localhost' || host === '::1') &&
      Number(u.port || 80) === config.port
    );
  } catch {
    return false;
  }
}

app.disable('x-powered-by');
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl / 同源无 Origin
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      if (isSameOrigin(origin)) return cb(null, true);
      // 非白名单来源：不回 CORS 头即可（浏览器自行拦截），绝不能抛错导致 500
      return cb(null, false);
    },
    credentials: false,
  })
);
app.use(express.json({ limit: '256kb' }));
app.use(requestContext);

// 安全头（本地场景也保留良好实践）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// API 响应一律不缓存：数据会随同步变化，缓存会导致看到旧数据
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// 首次访问若缓存过期，后台刷新（不阻塞响应）
app.use('/api', resolveProfile, (req, res, next) => {
  if (req.path.startsWith('/sync') || req.path === '/health' || req.path === '/bootstrap') return next();
  if (!req.ctx?.apiKey) return next();
  ensureFresh(req.ctx).catch((e) => logger.warn('ensure_fresh_failed', { error: e.message }));
  next();
});

app.use('/api', api);
app.use('/api', notFoundHandler);

// 静态前端（构建产物存在则托管）
const distDir = path.join(APP_ROOT_DIR, 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders(res, filePath) {
        // 入口 HTML 必须每次校验，否则重新构建后仍加载旧资源
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('前端尚未构建。请先运行：npm run build（在 app 目录下），或使用 npm run dev 启动 Vite 开发服务器。');
  });
}

app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.env,
    distServed: fs.existsSync(distDir),
    doubanEnabled: config.douban.enabled,
  });
  // 启动后初始化档案，并确保默认档案有数据
  (async () => {
    await profiles.init();
    const count = profiles.listProfiles().length;
    logger.info('profiles_ready', { count });
    if (!count) return;

    const id = profiles.defaultProfileId();
    let apiKey = null;
    try {
      apiKey = await profiles.getApiKey(id);
    } catch {
      apiKey = null;
    }
    if (!apiKey) return;
    await ensureFresh({ profileId: id, apiKey, requestId: 'boot' });
  })().catch((e) => logger.error('boot_sync_failed', { error: e.message }));
});

// 优雅停机
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_begin', { signal });
  const timer = setTimeout(() => {
    logger.warn('shutdown_force');
    process.exit(1);
  }, 8000);
  server.close(() => {
    clearTimeout(timer);
    logger.info('shutdown_done');
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error('unhandled_rejection', { error: err?.message });
});