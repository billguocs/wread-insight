import React, { useCallback, useEffect, useState } from 'react';
import { api, setProfileId, getProfileId } from './api.js';
import { useSyncWatcher, useToast } from './hooks.js';
import { useTheme } from './theme.js';
import { Icon, relTime, ErrorBox } from './components/ui.jsx';
import ProfileMenu from './components/ProfileMenu.jsx';
import Setup from './components/Setup.jsx';
import Shelf from './pages/Shelf.jsx';
import Analytics from './pages/Analytics.jsx';
import Notes from './pages/Notes.jsx';
import Discover from './pages/Discover.jsx';

const NAV = [
  { key: 'shelf', label: '我的书架', icon: 'shelf', sub: '全部藏书与阅读进度' },
  { key: 'analytics', label: '阅读数据', icon: 'chart', sub: '趋势、偏好与阅读画像' },
  { key: 'notes', label: '笔记管理', icon: 'note', sub: '划线、想法与导出' },
  { key: 'discover', label: '发现好书', icon: 'compass', sub: '个性化推荐与搜索' },
];

const THEME_META = {
  auto: { icon: 'monitor', label: '跟随系统' },
  light: { icon: 'sun', label: '浅色' },
  dark: { icon: 'moon', label: '深色' },
};

export default function App() {
  const [page, setPage] = useState(() => {
    const h = (window.location.hash || '').replace(/^#\/?/, '');
    return NAV.some((n) => n.key === h) ? h : 'shelf';
  });
  const [boot, setBoot] = useState(null);
  const [bootErr, setBootErr] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [notesBookId, setNotesBookId] = useState(null);
  const { msg, show } = useToast();
  const theme = useTheme();

  const loadBoot = useCallback(async () => {
    try {
      const b = await api.bootstrap();
      setBoot(b);
      setBootErr(null);
      // 服务端返回的默认档案与本地记录不一致时，以服务端为准
      if (!getProfileId() && b.activeProfileId) setProfileId(b.activeProfileId);
      if (b.needsSetup) setSetupOpen(true);
      return b;
    } catch (e) {
      setBootErr(e);
      return null;
    }
  }, []);

  useEffect(() => {
    loadBoot();
  }, [loadBoot]);

  const navigate = useCallback((key) => {
    setPage(key);
    if (window.location.hash !== `#/${key}`) window.location.hash = `#/${key}`;
  }, []);

  useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash || '').replace(/^#\/?/, '');
      if (NAV.some((n) => n.key === h)) setPage(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onSyncDone = useCallback(
    (s) => {
      setVersion((v) => v + 1);
      loadBoot();
      if (s.status === 'error') show('同步失败：' + (s.error || '未知错误'), 3600);
      else show('数据已更新');
    },
    [show, loadBoot]
  );

  const { status, meta, trigger, refreshMeta } = useSyncWatcher(onSyncDone, boot?.activeProfileId);
  const running = status.status === 'running';

  const goNotes = (bookId) => {
    setNotesBookId(bookId || null);
    navigate('notes');
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '1' && e.altKey) navigate('shelf');
      if (e.key === '2' && e.altKey) navigate('analytics');
      if (e.key === '3' && e.altKey) navigate('notes');
      if (e.key === '4' && e.altKey) navigate('discover');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const afterProfileChange = async () => {
    setSetupOpen(false);
    const b = await loadBoot();
    await refreshMeta();
    setVersion((v) => v + 1);
    if (b?.activeProfileId) show('已切换账号');
  };

  const handleCreated = async (created) => {
    setSetupOpen(false);
    await loadBoot();
    setVersion((v) => v + 1);
    show(`已接入「${created.name}」，正在同步…`, 3200);
  };

  const handleSwitch = async (id) => {
    setProfileId(id);
    await afterProfileChange();
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`确定移除「${name}」？该账号的本地快照与笔记缓存会一并删除。`)) return;
    try {
      await api.deleteProfile(id);
      if (getProfileId() === id) setProfileId('');
      await afterProfileChange();
      show('已移除账号');
    } catch (e) {
      show(e.message, 3200);
    }
  };

  if (bootErr) {
    return (
      <div className="setup">
        <div className="setup-card">
          <div className="setup-brand">
            <div className="brand-mark">细</div>
            <div>
              <div className="setup-title">细读</div>
              <div className="setup-sub">无法连接本地服务</div>
            </div>
          </div>
          <ErrorBox error={bootErr} onRetry={loadBoot} />
        </div>
      </div>
    );
  }

  if (setupOpen) {
    return <Setup onDone={handleCreated} onCancel={boot?.profiles?.length ? () => setSetupOpen(false) : null} />;
  }

  const nav = NAV.find((n) => n.key === page);
  const countShelf = meta?.counts?.shelfBooks
    ? meta.counts.shelfBooks + (meta.counts.shelfAlbums || 0)
    : null;
  const countNotes = meta?.counts?.noteBooks;
  const syncDot = running ? 'warn' : status.status === 'error' ? 'err' : '';
  const themeMeta = THEME_META[theme.mode];

  return (
    <div className="shell">
      {running ? (
        <div className="sync-bar">
          <i
            style={{
              width: `${
                status.total > 0 ? Math.round((status.done / status.total) * 100) : 22
              }%`,
            }}
          />
        </div>
      ) : null}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">细</div>
          <div className="brand-text">
            <b>细读</b>
            <span>WeRead Insight</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? 'active' : ''}`}
              onClick={() => navigate(n.key)}
              title={n.label}
            >
              <Icon name={n.icon} size={16} />
              <span className="nav-label">{n.label}</span>
              {n.key === 'shelf' && countShelf ? <span className="badge">{countShelf}</span> : null}
              {n.key === 'notes' && countNotes ? <span className="badge">{countNotes}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div>
            <span className={`dot ${syncDot}`} />
            <span className="txt">
              {running ? '同步中…' : status.status === 'error' ? '同步异常' : '数据就绪'}
            </span>
          </div>
          <div className="txt">更新于 {relTime(meta?.syncedAt)}</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{nav.label}</h1>
          <span className="sub">{nav.sub}</span>
          <div className="topbar-right">
            {running ? (
              <span className="sync-pill">
                <span className="spin" />
                {status.step || '同步中'}
                {status.total > 0 ? ` · ${status.done}/${status.total}` : ''}
              </span>
            ) : (
              <span className="sync-pill">
                <Icon name="clock" size={12} />
                {relTime(meta?.syncedAt)}
              </span>
            )}
            <button
              className="btn btn-sm"
              onClick={() => trigger('quick')}
              disabled={running || !boot?.hasKey}
              title="只刷新阅读统计与书架（约 10 秒）"
            >
              <Icon name="refresh" size={13} />
              <span>快速刷新</span>
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => trigger('full')}
              disabled={running || !boot?.hasKey}
              title="含全部笔记全文，约 30-60 秒"
            >
              <Icon name="download" size={13} />
              <span>全量同步</span>
            </button>

            <button
              className="icon-btn"
              onClick={theme.cycle}
              title={`主题：${themeMeta.label}（点击切换）`}
              aria-label="切换主题"
            >
              <Icon name={themeMeta.icon} size={15} />
            </button>

            <ProfileMenu
              bootstrap={boot}
              onSwitch={handleSwitch}
              onAdd={() => setSetupOpen(true)}
              onDelete={handleDelete}
              running={running}
            />
          </div>
        </header>

        <main className="page" key={`${page}-${version}`}>
          {page === 'shelf' ? (
            <Shelf onOpenNotes={goNotes} meta={meta} onToast={show} />
          ) : null}
          {page === 'analytics' ? <Analytics meta={meta} /> : null}
          {page === 'notes' ? (
            <Notes
              key={`notes-${version}`}
              initialBookId={notesBookId}
              onToast={show}
              meta={meta}
            />
          ) : null}
          {page === 'discover' ? <Discover onToast={show} onOpenNotes={goNotes} /> : null}
        </main>
      </div>

      {msg ? (
        <div className="toast">
          <Icon name="spark" size={13} />
          {msg}
        </div>
      ) : null}
    </div>
  );
}