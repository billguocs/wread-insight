import React, { useState } from 'react';
import { api, setProfileId } from '../api.js';
import { Icon } from './ui.jsx';

/**
 * 首次接入向导：填 API Key → 校验 → 创建档案并自动开始同步。
 * 不要求用户改 .env，也不需要别人帮忙配置。
 */
export default function Setup({ onDone, onCancel }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [probe, setProbe] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const canSubmit = key.trim().length > 6 && !busy;

  const doProbe = async () => {
    setErr(null);
    setProbe(null);
    setBusy(true);
    try {
      const r = await api.probeKey(key.trim());
      if (!r.ok) {
        setErr(r.message || 'API Key 校验未通过');
      } else {
        setProbe(r);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createProfile({ name: name.trim(), apiKey: key.trim() });
      setProfileId(created.id);
      onDone?.(created);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <form className="setup-card" onSubmit={submit}>
        <div className="setup-brand">
          <div className="brand-mark">细</div>
          <div>
            <div className="setup-title">细读</div>
            <div className="setup-sub">把你的微信读书，读成一份自己的数据</div>
          </div>
        </div>

        <div className="steps">
          <span>1 · 填入 API Key</span>
          <span>2 · 校验账号</span>
          <span>3 · 自动同步数据</span>
        </div>

        <h3>接入你的微信读书</h3>
        <div className="setup-desc">
          只需要一个微信读书 API Key。密钥仅保存在本机服务端（加密存储），
          不会出现在网页代码里，也不会被回传到浏览器。
        </div>

        <div className="field">
          <label>显示名称（可选）</label>
          <input
            className="input"
            placeholder="例如：我的阅读"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
          />
          <div className="hint">多人共用同一台机器时，用名称区分不同账号。</div>
        </div>

        <div className="field">
          <label>微信读书 API Key</label>
          <input
            className="input"
            placeholder="wrk-xxxxxxxxxxxxxxxx"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setProbe(null);
            }}
            autoComplete="off"
            spellCheck="false"
          />
          <div className="hint">
            格式形如 wrk-a1b2…c3d4。{!showHelp ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: '0 4px' }}
                onClick={() => setShowHelp(true)}
              >
                怎么获取？
              </button>
            ) : null}
          </div>
            {showHelp ? (
              <div className="hint" style={{ marginTop: 8 }}>
                在微信读书官方 Agent 接口的开放平台申请 API Key（绑定你的 vid），
                申请后把密钥粘贴到上面即可。密钥权限等同于你的个人阅读账号，请勿分享给他人。
              </div>
            ) : null}
        </div>

        {probe?.ok ? (
          <div className="probe-ok">
            <b>校验通过</b>
            <br />
            已识别累计阅读 {probe.readDays} 天 · {probe.totalHours} 小时，
            接入后会自动拉取书架与笔记。
          </div>
        ) : null}

        {err ? <div className="probe-err">{err}</div> : null}

        <div style={{ display: 'flex', gap: 9, marginTop: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={doProbe}
            disabled={!canSubmit}
          >
            {busy && !probe ? <span className="spin" /> : null}
            先校验一下
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit} style={{ flex: 1, justifyContent: 'center' }}>
            {busy ? <span className="spin" /> : <Icon name="spark" size={14} />}
            接入并开始同步
          </button>
        </div>

        <div className="hint" style={{ marginTop: 16 }}>
          接入后会自动执行一次全量同步（约 30–60 秒），期间可以先浏览界面。
          之后可按需在右上角「快速刷新 / 全量同步」更新数据。
        </div>

        {onCancel ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 12 }}
            onClick={onCancel}
          >
            取消，返回看板
          </button>
        ) : null}
      </form>
    </div>
  );
}