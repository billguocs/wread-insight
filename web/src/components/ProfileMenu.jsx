import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

/** 档案切换菜单：支持多账号接入与切换、删除 */
export default function ProfileMenu({ bootstrap, onSwitch, onAdd, onDelete, running }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const profiles = bootstrap?.profiles || [];
  const activeId = bootstrap?.activeProfileId;
  const active = profiles.find((p) => p.id === activeId);
  const initial = (active?.name || '细').slice(0, 1);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((v) => !v)}
        title="切换 / 添加账号"
        style={{ paddingLeft: 6 }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
            fontWeight: 600,
            flex: 'none',
          }}
        >
          {initial}
        </span>
        <span style={{ maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {active?.name || '未接入'}
        </span>
      </button>

      {open ? (
        <div className="menu">
          <div className="menu-label">阅读账号</div>
          {profiles.length === 0 ? (
            <div className="menu-item" style={{ cursor: 'default', color: 'var(--ink-3)' }}>
              还没有接入账号
            </div>
          ) : null}
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`menu-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (p.id !== activeId) onSwitch?.(p.id);
              }}
            >
              <Icon name="shelf" size={14} />
              <span className="mi-main">
                {p.name}
                <div className="mi-sub">
                  {p.hint || '未绑定密钥'}
                  {p.hasKey ? '' : ' · 待绑定'}
                </div>
              </span>
              {p.id === activeId ? <Icon name="check" size={13} /> : null}
            </button>
          ))}

          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onAdd?.();
            }}
          >
            <Icon name="spark" size={14} />
            <span className="mi-main">添加账号</span>
          </button>
          {active ? (
            <button
              className="menu-item danger"
              disabled={running}
              title={running ? '同步进行中，暂不能移除账号' : ''}
              style={running ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              onClick={() => {
                if (running) return;
                setOpen(false);
                onDelete?.(active.id, active.name);
              }}
            >
              <Icon name="close" size={14} />
              <span className="mi-main">移除「{active.name}」</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}