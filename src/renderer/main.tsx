import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './ipc';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/sidebar.css';
import './styles/topbar.css';
import './styles/main-content.css';
import './styles/right-column.css';
import './styles/settings.css';
import './styles/windows.css';
import './styles/dialogs.css';
import './styles/onboarding.css';

import { Cable, Download, Info, Mic2, TestTube2, Timer, Video } from 'lucide-react';
import { Sidebar, type SidebarPage } from './components/Sidebar';
import { TopBar, type SaveLabel } from './components/TopBar';
import { StatusBanner } from './components/StatusBanner';
import { LevelMeter } from './components/LevelMeter';
import { QuickActions } from './components/QuickActions';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectionStatusCard } from './components/widgets/ConnectionStatusCard';
import { HistoryCalendar } from './components/widgets/HistoryCalendar';
import { ProductivityChart } from './components/widgets/ProductivityChart';
import { HistoryList } from './components/HistoryList';
import { GuideDialog } from './components/dialogs/GuideDialog';
import { ManualDialog } from './components/dialogs/ManualDialog';
import { OnboardingWizard } from './components/OnboardingWizard';
import { AlertApp } from './components/AlertApp';
import { PreAlertApp } from './components/PreAlertApp';
import { FloatingApp } from './components/FloatingApp';

import { useSnapshot } from './hooks/useSnapshot';
import { useUpdateState } from './hooks/useUpdateState';
import { useAutoSave } from './hooks/useAutoSave';
import { shouldShowOnboarding } from './utils/status';
import { APP_VERSION } from './utils/appVersion';

import type { AppConfig, TestConnectionResult } from '../shared/types';

const root = createRoot(document.getElementById('root')!);

const route =
  window.location.hash === '#alert' ? 'alert'
    : window.location.hash === '#prealert' ? 'prealert'
    : window.location.hash === '#floating' ? 'floating'
    : 'settings';

document.body.dataset.route = route;
document.documentElement.dataset.route = route;

root.render(
  <React.StrictMode>
    {route === 'alert' ? <AlertApp />
      : route === 'prealert' ? <PreAlertApp />
      : route === 'floating' ? <FloatingApp />
      : <SettingsApp />}
  </React.StrictMode>
);

// =============================================================================
// SettingsApp — 3 栏主界面(左导航 / 中信息 / 右详情)
// =============================================================================
function SettingsApp() {
  const snapshot = useSnapshot();
  const updateState = useUpdateState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [page, setPage] = useState<SidebarPage>('dashboard');
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const aboutClickCount = useRef(0);
  const aboutClickTimer = useRef<NodeJS.Timeout | null>(null);

  const { saveState, scheduleSave, flushSave } = useAutoSave();

  useEffect(() => {
    if (!snapshot) return;
    setDraft((current) => current ?? snapshot.config);
  }, [snapshot]);

  // 切换页面时清空搜索框
  useEffect(() => {
    setSearch('');
  }, [page]);

  // ATEM 非全局快捷键：数字键 1-9 选 Preview，Enter 执行 AUTO（仅开发者模式）
  useEffect(() => {
    if (!developerMode || !snapshot || !snapshot.config.atemEnabled || snapshot.config.atemHotkeyGlobal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= snapshot.atemInputCount) {
        e.preventDefault();
        void window.obsGuard.changePreviewInput(num);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void window.obsGuard.autoTransition();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [snapshot, developerMode]);

  const updateDraft = useCallback(
    <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
      setDraft((current) => (current ? { ...current, [key]: value } : current));
      scheduleSave({ [key]: value } as Partial<AppConfig>);
    },
    [scheduleSave]
  );

  const openSettings = useCallback((focus?: string) => {
    setSettingsFocus(focus ?? null);
    setSettingsOpen(true);
  }, []);

  const closeGuide = useCallback(async () => {
    setShowGuide(false);
    setSettingsFocus(null);
    if (snapshot && shouldShowOnboarding(snapshot.config, APP_VERSION)) {
      await flushSave({ hasSeenGuide: true, guideSeenVersion: APP_VERSION });
    }
  }, [snapshot, flushSave]);

  const testConnection = useCallback(async () => {
    if (!draft) return;
    setTestingConnection(true);
    try {
      setTestResult(await window.obsGuard.testConnection(draft));
    } finally {
      setTestingConnection(false);
    }
  }, [draft]);

  const checkForUpdates = useCallback(async () => { await window.obsGuard.checkForUpdates(); }, []);
  const downloadUpdate = useCallback(async () => { await window.obsGuard.downloadUpdate(); }, []);

  const resetToFactoryDefaults = useCallback(async () => {
    const confirmed = window.confirm('确定恢复出厂设置吗?这会清空本地设置和报警历史,并重新打开新手引导。');
    if (!confirmed) return;
    try {
      const next = await window.obsGuard.resetConfig();
      setDraft(next.config);
      setTestResult(null);
      setShowManual(false);
      // 重置后 hasSeenGuide 变为 false,OnboardingWizard 会自动显示
    } catch { /* ignore */ }
  }, []);

  // 开发者模式：点击 5 次"关于"解锁实验功能

  if (!snapshot || !draft) {
    return <div className="boot-screen">正在启动 OBS 音频检测助手…</div>;
  }

  // 首次安装或版本更新：显示引导向导，不清空已有配置。
  if (shouldShowOnboarding(snapshot.config, APP_VERSION)) {
    return (
      <OnboardingWizard
        draft={draft}
        snapshot={snapshot}
        onUpdateDraft={updateDraft}
        onComplete={() => {
          void flushSave({ hasSeenGuide: true, guideSeenVersion: APP_VERSION });
        }}
        onTestConnection={() => void testConnection()}
        onRefreshInputs={() => void window.obsGuard.refreshInputs()}
        testResult={testResult}
        testingConnection={testingConnection}
      />
    );
  }

  const saveLabel: SaveLabel = {
    text: saveState === 'saving' ? '自动保存中' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : '实时保存',
    state: saveState
  };

  const liveModeLabel = snapshot.simulatedLive ? '模拟开播' : snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播';
  const pageTitle = page === 'dashboard' ? liveModeLabel : '报警历史';
  const hasUpdateNotice = updateState ? ['available', 'downloaded', 'error'].includes(updateState.status) : false;

  // 主中栏内容(根据 page 切换)
  const mainContent = (
    <>
      {page === 'dashboard' && (
        <>
          <div className="page-header">
            <div className="page-header-title">
              <h1>
                <span>{pageTitle}</span>
              </h1>
              <p className="page-header-subtitle">
                {snapshot.config.targetInputName || '未选择音源'} · 检测中{search ? ` · 搜索 "${search}"` : ''}
              </p>
            </div>
          </div>

          <StatusBanner snapshot={snapshot} />

          <LevelMeter
            snapshot={snapshot}
            draft={draft}
            onChangeThreshold={(v) => updateDraft('silenceThresholdDb', v)}
          />

          <QuickActions
            snapshot={snapshot}
            onTogglePause={() => void window.obsGuard.setPaused(!snapshot.config.paused)}
            onToggleFloating={() => void window.obsGuard.setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled)}
            onReconnect={() => void window.obsGuard.reconnect()}
          />

          {/* ATEM 导播台状态 — 仅开发者模式可见 */}
          {developerMode && snapshot.config.atemEnabled && (
            <div className="event-list">
              <div className="event-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div className="event-time tone-blue">
                    <Video size={18} />
                  </div>
                  <div className="event-body">
                    <div className="event-title">ATEM 导播台</div>
                    <div className="event-meta">
                      {snapshot.atemConnected
                        ? `PGM: ${snapshot.atemProgramInput}  ·  PVW: ${snapshot.atemPreviewInput}`
                        : '未连接 — 请在设置中配置 ATEM IP'}
                    </div>
                  </div>
                </div>
                {snapshot.atemConnected && snapshot.atemInputCount > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%' }}>
                    {Array.from({ length: Math.min(snapshot.atemInputCount, 8) }, (_, i) => i + 1).map((num) => {
                      const isProgram = num === snapshot.atemProgramInput;
                      const isPreview = num === snapshot.atemPreviewInput;
                      return (
                        <span key={num} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 10, fontSize: 11.5, fontWeight: 600,
                          background: isProgram ? 'var(--red-soft)' : isPreview ? 'var(--green-50)' : 'var(--neutral-100)',
                          color: isProgram ? 'var(--red-text)' : isPreview ? 'var(--green-700)' : 'var(--text-secondary)',
                          border: isProgram ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--glass-border)' }}
                        >
                          {num}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {page === 'history' && (
        <>
          <div className="page-header">
            <div className="page-header-title">
              <h1><span>报警历史</span></h1>
              <p className="page-header-subtitle">本地保存最近 20 条报警记录</p>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn-secondary" onClick={() => void window.obsGuard.clearHistory()}>
                清空历史
              </button>
            </div>
          </div>
          <HistoryList snapshot={snapshot} onClear={() => void window.obsGuard.clearHistory()} />
        </>
      )}

      {/* settings 页面已移除 — 点击 Sidebar"设置"直接打开 SettingsPanel */}
    </>
  );

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      <Sidebar
        snapshot={snapshot}
        active={page}
        onChange={setPage}
        onOpenSettings={() => openSettings('connection')}
        historyCount={snapshot.history.length}
      />
      <section className="app-main-content">
        <TopBar
          searchPlaceholder={page === 'history' ? '搜索报警记录…' : '搜索音源、历史记录…'}
          onSearchChange={setSearch}
          saveLabel={saveLabel}
          onNotifications={() => openSettings('updates')}
          hasUpdateNotice={hasUpdateNotice}
        />
        {mainContent}
      </section>
      <aside className="right-column">
        <ConnectionStatusCard snapshot={snapshot} />
        <ProductivityChart history={snapshot.history} />
        <HistoryCalendar history={snapshot.history} />
      </aside>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setSettingsFocus(null); }}
        snapshot={snapshot}
        draft={draft}
        onChangeDraft={updateDraft}
        updateState={updateState}
        onCheckUpdate={() => void checkForUpdates()}
        onDownloadUpdate={() => void downloadUpdate()}
        onInstallUpdate={() => void window.obsGuard.installUpdate()}
        testingConnection={testingConnection}
        testResult={testResult}
        onTestConnection={() => void testConnection()}
        onOpenManual={() => setShowManual(true)}
        onReset={() => void resetToFactoryDefaults()}
        appVersion={APP_VERSION}
        focusSection={settingsFocus}
      />

      {showGuide && (
        <GuideDialog
          onClose={() => void closeGuide()}
          onTestConnection={() => void testConnection()}
          onSetDiagnostics={() => openSettings('diagnostics')}
          onOpenDrawer={(id) => openSettings(id)}
          testResult={testResult}
          testingConnection={testingConnection}
        />
      )}
      {showManual && <ManualDialog onClose={() => setShowManual(false)} />}
    </main>
  );
}

// =============================================================================
// 快捷入口卡(在 page='settings' 时显示,点开即跳到对应设置 section)
// 注意:现在 page='settings' 已移除,本组件保留备用(若未来重新加入中间页)
// =============================================================================
const SHORTCUT_CARDS: { id: string; title: string; desc: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'connection', title: 'OBS 连接', desc: 'WebSocket 地址与密码', icon: Cable },
  { id: 'source', title: '目标音源', desc: '选择需要守护的音频源', icon: Mic2 },
  { id: 'rules', title: '报警规则', desc: '静音时长与阈值', icon: Timer },
  { id: 'diagnostics', title: '诊断测试', desc: '本地调试工具', icon: TestTube2 },
  { id: 'updates', title: '软件更新', desc: '检查 GitHub 新版本', icon: Download },
  { id: 'about', title: '关于', desc: `当前 v${APP_VERSION}`, icon: Info }
];

function SettingsShortcutCards({ onPick }: { onPick: (section: string) => void }) {
  return (
    <div className="event-list">
      {SHORTCUT_CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <div className="event-item shortcut-card" key={c.id} onClick={() => onPick(c.id)} role="button" tabIndex={0}>
            <div className="event-time tone-green shortcut-card-icon">
              <Icon size={20} />
            </div>
            <div className="event-body">
              <div className="event-title">{c.title}</div>
              <div className="event-meta">{c.desc}</div>
            </div>
            <div className="event-action">
              <button type="button" className="btn-secondary" style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }} onClick={(e) => { e.stopPropagation(); onPick(c.id); }}>
                打开
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
