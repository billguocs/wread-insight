import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** 为每个请求注入 requestId，并输出访问日志 */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && incoming.length < 80 ? incoming : randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  const t0 = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('http_request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - t0,
    });
  });
  next();
}

/** 包装 async 处理器，异常交给全局错误中间件 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** 全局错误处理：只返回规范化结构，绝不泄露堆栈 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isApp = err instanceof AppError;
  const status = isApp ? err.status : 500;

  if (status >= 500) {
    logger.error('unhandled_error', {
      requestId: req.id,
      path: req.path,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }

  res.status(status).json({
    error: {
      code: isApp ? err.code : 'internal_error',
      message: status >= 500 ? '服务器内部错误，请稍后重试' : err.message,
      requestId: req.id,
      ...(isApp && err.details ? { details: err.details } : {}),
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `接口不存在: ${req.method} ${req.path}`, requestId: req.id },
  });
}