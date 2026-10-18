import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { UpstreamError, UnauthorizedError } from '../lib/errors.js';

/**
 * 微信读书 Agent API 客户端。
 * 约定：业务参数平铺在 body 顶层，与 api_name / skill_version 同级。
 * 身份由调用方传入的 apiKey 决定（多档案隔离）。
 */
export async function wereadCall(apiName, params = {}, { timeoutMs, requestId, apiKey } = {}) {
  if (!apiKey) {
    throw new UnauthorizedError('未绑定微信读书 API Key，请先完成接入');
  }
  const body = { api_name: apiName, ...params, skill_version: config.weread.skillVersion };
  const url = config.weread.gateway;
  const attempts = 3;
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? config.weread.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedError();
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new UpstreamError(`微信读书接口 HTTP ${res.status}`, {
          service: 'weread',
          status: 502,
          cause: text.slice(0, 200),
        });
      }

      const data = await res.json();
      if (data.upgrade_info) {
        logger.warn('weread_sdk_upgrade_required', {
          requestId,
          message: data.upgrade_info.message,
        });
      }
      if (data.errcode !== 0 && data.errcode != null) {
        throw new UpstreamError(`微信读书接口返回错误: ${data.errmsg || data.errcode}`, {
          service: 'weread',
          cause: `errcode=${data.errcode}`,
        });
      }
      return data;
    } catch (err) {
      lastErr = err;
      // 鉴权错误不重试
      if (err instanceof UnauthorizedError) throw err;
      const isClientErr = err instanceof UpstreamError && err.status < 500;
      if (isClientErr) throw err;
      if (i < attempts - 1) {
        await sleep(400 * (i + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  logger.error('weread_call_failed', {
    requestId,
    api: apiName,
    error: lastErr?.message,
  });
  throw lastErr instanceof Error
    ? lastErr
    : new UpstreamError('微信读书接口调用失败', { service: 'weread' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 校验 API Key 是否可用，并顺带返回一点概况用于接入确认 */
export async function probeApiKey(apiKey, { requestId } = {}) {
  try {
    const d = await wereadCall('/readdata/detail', { mode: 'overall' }, { apiKey, requestId });
    return {
      ok: true,
      readDays: Number(d.readDays) || 0,
      totalHours: Math.round((Number(d.totalReadTime) || 0) / 360) / 10,
      registTime: d.registTime || null,
    };
  } catch (err) {
    return { ok: false, message: err.message, code: err.code || 'invalid_key' };
  }
}

/** 微秒级并发控制，避免打爆上游 */
export function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}