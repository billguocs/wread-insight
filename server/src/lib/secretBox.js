import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * 密钥落盘加密（AES-256-GCM）。
 * 主密钥首次运行时随机生成并存于 storage/.secret（权限 0600），
 * 用户 API Key 只以密文形式写入 profiles.json，且永不通过接口返回。
 */
let masterKey = null;

async function loadMasterKey() {
  if (masterKey) return masterKey;
  await fs.mkdir(config.storage.dir, { recursive: true });
  try {
    const raw = await fs.readFile(config.storage.secretKeyFile, 'utf8');
    const buf = Buffer.from(raw.trim(), 'base64');
    if (buf.length !== 32) throw new Error('主密钥长度异常');
    masterKey = buf;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    masterKey = crypto.randomBytes(32);
    await fs.writeFile(
      config.storage.secretKeyFile,
      masterKey.toString('base64'),
      { encoding: 'utf8', mode: 0o600 }
    );
  }
  return masterKey;
}

export async function encrypt(plain) {
  if (!plain) return null;
  const key = await loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export async function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('密文格式不正确');
  const key = await loadMasterKey();
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** 生成可展示的密钥提示，如 wrk-a1b2…c3d4，不泄露完整密钥 */
export function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 12) return '****';
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

export function secretPathExists() {
  return fs
    .access(config.storage.secretKeyFile)
    .then(() => true)
    .catch(() => false);
}

export const secretKeyDir = path.dirname(config.storage.secretKeyFile);