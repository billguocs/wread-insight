import { logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import * as profileStore from '../repositories/profileStore.js';

const { getProfile, getApiKey, defaultProfileId, touch } = profileStore;

/**
 * 解析当前请求所属档案。
 * 优先取 X-Profile-Id 头（前端保存在本地），否则回退到最近使用的档案。
 * 解析结果挂在 req.ctx = { profileId, apiKey, requestId }。
 */
export async function resolveProfile(req, res, next) {
  try {
    // 冷启动时首个请求可能早于 boot 的 init 完成，这里确保已初始化
    await profileStore.init();

    const fromHeader = String(req.get('x-profile-id') || '').trim();
    const id = fromHeader && getProfile(fromHeader) ? fromHeader : defaultProfileId();

    if (!id) {
      req.ctx = { profileId: null, apiKey: null, requestId: req.id };
      req.profile = null;
      return next();
    }

    const profile = getProfile(id);
    let apiKey = null;
    try {
      apiKey = await getApiKey(id);
    } catch (err) {
      // 档案存在但未绑定密钥，仍允许浏览已有快照
      if (err.status && err.status !== 500) apiKey = null;
      else logger.warn('profile_key_decrypt_failed', { requestId: req.id, error: err.message });
    }

    req.profile = profile;
    req.ctx = { profileId: id, apiKey, requestId: req.id };
    // 记录活跃时间（不阻塞请求）
    touch(id).catch(() => {});
    return next();
  } catch (err) {
    return next(err);
  }
}

/** 需要已完成接入的档案（有档案且有密钥） */
export function requireProfileCtx(req, res, next) {
  if (!req.ctx?.profileId) {
    return next(
      new AppError('尚未接入任何微信读书账号', { code: 'no_profile', status: 428 })
    );
  }
  return next();
}

/** 需要档案已绑定 API Key（涉及上游调用的接口） */
export function requireApiKey(req, res, next) {
  if (!req.ctx?.profileId) {
    return next(new AppError('尚未接入任何微信读书账号', { code: 'no_profile', status: 428 }));
  }
  if (!req.ctx?.apiKey) {
    return next(new AppError('该档案尚未绑定 API Key', { code: 'no_api_key', status: 428 }));
  }
  return next();
}