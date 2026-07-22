import React, { useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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
import './styles/preflight.css';

import { Activity, ArrowRight, BarChart3, Cable, Clock3, Download, Gauge, Info, ListChecks, Mic2, TestTube2, Timer, Video } from 'lucide-react';
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
import { AlertBackdropApp } from './components/AlertBackdropApp';
import { PreAlertApp } from './components/PreAlertApp';
import { FloatingApp } from './components/FloatingApp';
import { ToastAlertApp } from './components/ToastAlertApp';
import { StyledSelect } from './components/StyledSelect';
import { PreflightCheckPage } from './components/PreflightCheckPage';

import { useSnapshot } from './hooks/useSnapshot';
import { useUpdateState } from './hooks/useUpdateState';
import { useAutoSave } from './hooks/useAutoSave';
import { formatDb, shouldShowOnboarding } from './utils/status';
import { APP_VERSION } from './utils/appVersion';
import { defaultATEMInputColor } from '../shared/atemPalette';

import type { AppConfig, AppSnapshot, TestConnectionResult, VolumeHistoryPoint } from '../shared/types';

const rootElement = document.getElementById('root') as (HTMLElement & { __obsGuardReactRoot?: Root }) | null;
if (!rootElement) {
  throw new Error('渲染容器不存在');
}
// Vite 热更新会重新执行这个入口模块。复用同一个 React root，避免
// createRoot 在同一个 DOM 容器上重复挂载并导致 Electron 渲染进程崩溃。
const root = rootElement.__obsGuardReactRoot ?? createRoot(rootElement);
rootElement.__obsGuardReactRoot = root;

const route =
  window.location.hash === '#alert' ? 'alert'
    : window.location.hash === '#alert-backdrop' ? 'alert-backdrop'
    : window.location.hash === '#toast-alert' ? 'toast-alert'
    : window.location.hash === '#prealert' ? 'prealert'
    : window.location.hash === '#floating' ? 'floating'
    : 'settings';

const initialSettingsPage = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('page');

document.body.dataset.route = route;
document.documentElement.dataset.route = route;

class RendererErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] unhandled render error', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <main className="boot-screen">
          <strong>界面暂时无法显示</strong>
          <span>检测仍在后台运行。重新加载界面即可恢复查看。</span>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>重新加载界面</button>
        </main>
      );
    }

    return this.props.children;
  }
}

root.render(
  <RendererErrorBoundary>
    {route === 'alert' ? <AlertApp />
      : route === 'alert-backdrop' ? <AlertBackdropApp />
      : route === 'toast-alert' ? <ToastAlertApp />
      : route === 'prealert' ? <PreAlertApp />
      : route === 'floating' ? <FloatingApp />
      : <SettingsApp />}
  </RendererErrorBoundary>
);

// =============================================================================
// SettingsApp — 3 栏主界面(左导航 / 中信息 / 右详情)
// =============================================================================
function SettingsApp() {
  const snapshot = useSnapshot();
  const updateState = useUpdateState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [page, setPage] = useState<SidebarPage>(initialSettingsPage === 'preflight' ? 'preflight' : 'dashboard');
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const { saveState, scheduleSave, flushSave } = useAutoSave((next) => setDraft(next.config));

  useEffect(() => {
    if (!snapshot) return;
    setDraft((current) => current && saveState === 'saving' ? current : snapshot.config);
  }, [snapshot?.config, saveState]);

  // 切换页面时清空搜索框
  useEffect(() => {
    setSearch('');
  }, [page]);

  // ATEM 应用内快捷键：ATEM 页面中数字键 1-8 选 Preview，Enter 执行 AUTO。
  useEffect(() => {
    if (page !== 'atem' || !snapshot || !snapshot.config.atemEnabled || snapshot.config.atemHotkeyGlobal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8 && snapshot.atemInputIds.includes(num)) {
        e.preventDefault();
        void window.obsGuard.changePreviewInput(num).catch((error) => {
          console.error('[ATEM] preview shortcut failed', error);
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const previewLabel = snapshot.atemInputLabels[snapshot.atemPreviewInput] || `PGM ${snapshot.atemPreviewInput}`;
        if (snapshot.config.atemHardCutConfirm && !window.confirm(`确认将 ${previewLabel} 从 PVW 切换到 PGM 吗？`)) return;
        void window.obsGuard.autoTransition().catch((error) => {
          console.error('[ATEM] AUTO shortcut failed', error);
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [snapshot, page]);

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
  const completeOnboarding = useCallback(() => {
    void flushSave({ hasSeenGuide: true, guideSeenVersion: APP_VERSION });
  }, [flushSave]);
  const refreshOnboardingInputs = useCallback(() => {
    void window.obsGuard.refreshInputs();
  }, []);

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
        onComplete={completeOnboarding}
        onTestConnection={testConnection}
        onRefreshInputs={refreshOnboardingInputs}
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
  const pageTitle = page === 'dashboard' ? liveModeLabel : page === 'atem' ? 'ATEM 导播台' : page === 'monitor' ? '监控面板 Beta' : '报警历史';
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
                {snapshot.activeInputName || snapshot.config.targetInputNames.join('、') || snapshot.config.targetInputName || '未选择音源'} · 检测中{search ? ` · 搜索 "${search}"` : ''}
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
        </>
      )}

      {page === 'monitor' && (
        <>
          <div className="page-header">
            <div className="page-header-title">
              <h1>
                <span>监控面板</span>
                <span className="page-title-badge">BETA</span>
              </h1>
              <p className="page-header-subtitle">
                OBS 性能、全部音频输入、电平历史与静音事件
              </p>
            </div>
          </div>
          <MonitoringDashboard snapshot={snapshot} search={search} />
        </>
      )}

      {page === 'preflight' && (
        <PreflightCheckPage
          draft={draft}
          search={search}
          onChange={updateDraft}
        />
      )}

      {page === 'atem' && (
        <ATEMConsole
          snapshot={snapshot}
          draft={draft}
          search={search}
          onChange={updateDraft}
          onOpenSettings={() => openSettings('atem')}
        />
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
          <HistoryList snapshot={snapshot} onClear={() => void window.obsGuard.clearHistory()} search={search} />
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
          searchPlaceholder={page === 'history' ? '搜索报警记录…' : page === 'atem' ? '搜索 ATEM 机位…' : page === 'preflight' ? '搜索开播项目…' : '搜索音源、历史记录…'}
          onSearchChange={setSearch}
          saveLabel={saveLabel}
          onNotifications={() => openSettings('updates')}
          hasUpdateNotice={hasUpdateNotice}
        />
        <div className="page-transition" key={page}>{mainContent}</div>
      </section>
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
        saveState={saveState}
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

function ATEMConsole({
  snapshot,
  draft,
  search,
  onChange,
  onOpenSettings
}: {
  snapshot: AppSnapshot;
  draft: AppConfig;
  search: string;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  onOpenSettings: () => void;
}) {
  const [operation, setOperation] = useState<{ tone: 'pending' | 'ok' | 'bad'; text: string } | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('current');
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false);
  const liveActive = snapshot.streaming || snapshot.recording || snapshot.simulatedLive;
  const elapsed = snapshot.atemProgramInputElapsedSeconds;
  const limit = Math.max(10, draft.atemCameraTimeLimitSeconds);
  const remaining = Math.max(0, limit - elapsed);
  const progress = Math.min(100, (elapsed / limit) * 100);
  const warning = liveActive && draft.atemCameraTimeAlertEnabled && elapsed >= limit * 0.75;
  const timerTone = !liveActive ? 'idle' : snapshot.atemProgramInputOverLimit ? 'danger' : warning ? 'warning' : 'safe';
  const query = search.trim().toLowerCase();
  const visibleInputs = snapshot.atemInputIds.filter((inputId) => {
    const label = snapshot.atemInputLabels[inputId] || `Input ${inputId}`;
    const group = draft.atemInputCustomizations[String(inputId)]?.group || '未分组';
    return !query || `${inputId} ${label} ${group}`.toLowerCase().includes(query);
  });
  const groupedInputs = Array.from(visibleInputs.reduce((groups, inputId) => {
    const group = draft.atemInputCustomizations[String(inputId)]?.group || '未分组';
    const list = groups.get(group) ?? [];
    list.push(inputId);
    groups.set(group, list);
    return groups;
  }, new Map<string, number[]>()));
  const sessions = [snapshot.atemCurrentSession, ...snapshot.atemRecentSessions].filter(Boolean) as NonNullable<AppSnapshot['atemCurrentSession']>[];
  const selectedSession = selectedSessionId === 'current' && snapshot.atemCurrentSession
    ? snapshot.atemCurrentSession
    : sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
  const programLabel = snapshot.atemInputLabels[snapshot.atemProgramInput] || '未读取播出信号';
  const previewLabel = snapshot.atemInputLabels[snapshot.atemPreviewInput] || '未读取预览信号';
  const selectedSessionSwitches = (selectedSession?.segments ?? []).slice(0, -1).map((segment, index) => ({
    id: `${segment.id}-${selectedSession?.segments[index + 1]?.id}`,
    switchedAt: segment.endedAt,
    fromInputId: segment.inputId,
    fromInputLabel: draft.atemInputCustomizations[String(segment.inputId)]?.name || segment.inputLabel,
    toInputId: selectedSession!.segments[index + 1].inputId,
    toInputLabel: draft.atemInputCustomizations[String(selectedSession!.segments[index + 1].inputId)]?.name || selectedSession!.segments[index + 1].inputLabel,
    durationSeconds: segment.durationSeconds
  })).reverse();
  const dominantSessionInput = selectedSession?.usage[0] ?? null;

  useEffect(() => {
    setSessionDetailsOpen(false);
  }, [selectedSessionId]);

  const openATEMFloating = () => {
    onChange('floatingWindowMode', 'audio_atem');
    onChange('floatingWindowModules', { ...draft.floatingWindowModules, atem: true });
    onChange('floatingWindowEnabled', true);
  };

  const runATEMAction = async (pendingText: string, successText: string, action: () => Promise<void>) => {
    setOperation({ tone: 'pending', text: pendingText });
    try {
      await action();
      setOperation({ tone: 'ok', text: successText });
    } catch (error) {
      setOperation({ tone: 'bad', text: error instanceof Error ? error.message : 'ATEM 操作失败' });
    }
  };

  const hardCut = async () => {
    if (snapshot.atemPreviewInput <= 0) return;
    if (draft.atemHardCutConfirm && !window.confirm(`确认硬切到 ${previewLabel} 吗？`)) return;
    await runATEMAction('正在执行硬切…', `已硬切到 ${previewLabel}`, () => window.obsGuard.changeProgramInput(snapshot.atemPreviewInput));
  };

  const autoCut = async () => {
    if (snapshot.atemPreviewInput <= 0) return;
    if (draft.atemHardCutConfirm && !window.confirm(`确认将 ${previewLabel} 从 PVW 切换到 PGM 吗？`)) return;
    await runATEMAction('正在执行 AUTO 切换…', `已切换到 ${previewLabel}`, () => window.obsGuard.autoTransition());
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1><span>ATEM 导播台</span></h1>
          <p className="page-header-subtitle">播出机位、预览信号与单机位停留时间</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-secondary" onClick={onOpenSettings}>连接设置</button>
          <button type="button" className="btn-secondary" onClick={openATEMFloating}>打开机位小窗</button>
          <button
            type="button"
            className="btn-primary atem-reconnect-button"
            onClick={() => void runATEMAction('正在重新连接 ATEM…', 'ATEM 重连请求已完成', () => window.obsGuard.atemReconnect())}
            disabled={!draft.atemEnabled || operation?.tone === 'pending'}
          >重新连接</button>
        </div>
      </div>

      <section className="atem-overview">
        <article className="atem-live-card program">
          <span>正在播出 PGM</span>
          <div><strong>{snapshot.atemProgramInput || '--'}</strong><b>{programLabel}</b></div>
        </article>
        <article className="atem-live-card preview">
          <span>预览队列 PVW</span>
          <div><strong>{snapshot.atemPreviewInput || '--'}</strong><b>{previewLabel}</b></div>
        </article>
        <article className={`atem-timer-card ${timerTone}`}>
          <header>
            <span>当前机位计时</span>
            <button type="button" className={`atem-timer-toggle ${draft.atemCameraTimeAlertEnabled ? 'active' : ''}`} onClick={() => onChange('atemCameraTimeAlertEnabled', !draft.atemCameraTimeAlertEnabled)}>
              {draft.atemCameraTimeAlertEnabled ? '报警开启' : '报警关闭'}
            </button>
          </header>
          <strong>{formatATEMTime(elapsed)}</strong>
          <div className="atem-timer-progress"><i style={{ width: `${progress}%` }} /></div>
          <footer>
            <span>{!liveActive ? '等待直播、录制或模拟开播' : snapshot.atemProgramInputOverLimit ? `已超时 ${formatATEMTime(elapsed - limit)}` : `剩余 ${formatATEMTime(remaining)}`}</span>
            <button type="button" onClick={onOpenSettings}>阈值 {formatATEMTime(limit)}</button>
          </footer>
        </article>
      </section>

      <div className={`atem-connection-banner ${snapshot.atemConnected ? 'connected' : 'disconnected'}`}>
        <span><i />{snapshot.atemConnected ? `${snapshot.atemModelName || 'ATEM'} 已连接 · ${draft.atemHost}` : draft.atemEnabled ? 'ATEM 尚未连接，请检查 IP 和网络' : 'ATEM 功能未开启'}</span>
        <b>{snapshot.atemConnected && snapshot.atemInputCount === 0 ? '正在同步信号…' : `${snapshot.atemInputCount} 路常用信号`}</b>
      </div>
      {operation && <div className={`atem-operation-banner ${operation.tone}`}>{operation.text}</div>}

      <section className="atem-source-panel">
        <header>
          <div><strong>信号源</strong><span>仅显示 CAM 1–8、Color、彩条和 Media Player</span></div>
          <em>点击信号源只会选入 PVW，不会直接改变播出画面</em>
        </header>
        <div className="atem-source-groups">
          {groupedInputs.map(([group, inputIds]) => <div className="atem-source-group" key={group}>
            <div className="atem-source-group-title"><span>{group}</span><b>{inputIds.length} 路</b></div>
            <div className="atem-source-grid">
          {inputIds.map((inputId) => {
            const isProgram = inputId === snapshot.atemProgramInput;
            const isPreview = inputId === snapshot.atemPreviewInput;
            const label = snapshot.atemInputLabels[inputId] || `Input ${inputId}`;
            const color = draft.atemInputCustomizations[String(inputId)]?.color || defaultATEMInputColor(inputId);
            return (
              <button
                type="button"
                key={inputId}
                className={`atem-source-button ${isProgram ? 'program' : ''} ${isPreview ? 'preview' : ''}`}
                style={{ '--atem-source-color': color } as React.CSSProperties}
                onClick={() => void runATEMAction(`正在选择 ${label}…`, `${label} 已选入 PVW`, () => window.obsGuard.changePreviewInput(inputId))}
                disabled={!snapshot.atemConnected || operation?.tone === 'pending'}
              >
                <span>{inputId >= 1 && inputId <= 8 ? `CAM ${inputId}` : label}</span>
                <strong>{label}</strong>
                <em>{isProgram ? '正在播出' : isPreview ? '已在预览' : '选入预览'}</em>
              </button>
            );
          })}
            </div>
          </div>)}
          {snapshot.atemConnected && visibleInputs.length === 0 && (
            <div className="atem-source-empty">
              {query ? '没有符合搜索条件的常用信号源' : '正在同步 ATEM 信号源，无需切换页面'}
            </div>
          )}
          {!snapshot.atemConnected && <div className="atem-source-empty">连接 ATEM 后显示可用信号源</div>}
        </div>
      </section>

      <section className="atem-transition-panel">
        <div><strong>执行切换</strong><span>先选择 PVW，再执行 AUTO 或 Hard Cut</span></div>
        <div className="atem-transition-actions">
          <button
            type="button"
            className="atem-auto-button"
            onClick={() => void autoCut()}
            disabled={!snapshot.atemConnected || snapshot.atemPreviewInput <= 0 || operation?.tone === 'pending'}
          >AUTO 柔切</button>
          <button type="button" className="atem-hardcut-button" onClick={() => void hardCut()} disabled={!snapshot.atemConnected || snapshot.atemPreviewInput <= 0 || operation?.tone === 'pending'}>Hard Cut 硬切</button>
        </div>
      </section>

      {draft.developerModeEnabled && <section className="atem-session-panel">
        <header>
          <div><strong><Clock3 size={17} /> 直播机位统计</strong><span>按直播或录制场次保存，自动保留最近 10 场</span></div>
          {sessions.length > 0 && (
            <StyledSelect
              className="atem-session-select"
              ariaLabel="选择直播场次"
              value={selectedSession?.id === snapshot.atemCurrentSession?.id ? 'current' : selectedSession?.id ?? ''}
              onChange={setSelectedSessionId}
              options={[
                ...(snapshot.atemCurrentSession ? [{ value: 'current', label: '当前直播', description: formatATEMSwitchDate(snapshot.atemCurrentSession.startedAt) }] : []),
                ...snapshot.atemRecentSessions.map((session, index) => ({
                  value: session.id,
                  label: `第 ${index + 1} 场直播`,
                  description: formatATEMSwitchDate(session.startedAt)
                }))
              ]}
            />
          )}
        </header>
        {selectedSession && selectedSession.totalDurationSeconds > 0 ? (
          <>
            <div className="atem-session-summary">
              <article>
                <span>场次时间</span>
                <strong>{selectedSession.endedAt === null ? '直播进行中' : formatATEMSwitchDate(selectedSession.startedAt)}</strong>
              </article>
              <article>
                <span>已统计时长</span>
                <strong>{formatATEMDuration(selectedSession.totalDurationSeconds)}</strong>
              </article>
              <article>
                <span>机位切换</span>
                <strong>{selectedSessionSwitches.length} 次</strong>
              </article>
              <article className="dominant">
                <i style={{ background: dominantSessionInput?.color ?? defaultATEMInputColor(1) }} />
                <span>主力机位</span>
                <strong>{dominantSessionInput ? `${dominantSessionInput.inputLabel} · ${dominantSessionInput.percent.toFixed(1)}%` : '暂无数据'}</strong>
              </article>
              <button type="button" className="atem-session-details-toggle" onClick={() => setSessionDetailsOpen((open) => !open)}>
                <ListChecks size={16} /> {sessionDetailsOpen ? '收起场次详情' : '查看时间轴与详情'}
              </button>
            </div>

            {sessionDetailsOpen && (
              <div className="atem-session-details">
                <section>
                  <header><strong>机位时间轴</strong><span>{formatATEMDuration(selectedSession.totalDurationSeconds)}</span></header>
                  <div className="atem-session-timeline" aria-label="机位切换时间轴">
                    {selectedSession.segments.map((segment) => {
                      const custom = draft.atemInputCustomizations[String(segment.inputId)];
                      const width = Math.max(1.5, segment.durationSeconds / selectedSession.totalDurationSeconds * 100);
                      const color = custom?.color || defaultATEMInputColor(segment.inputId);
                      return <span key={segment.id} style={{ width: `${width}%`, background: color }} title={`${custom?.name || segment.inputLabel} · ${formatATEMDuration(segment.durationSeconds)}`} />;
                    })}
                  </div>
                  <div className="atem-session-usage">
                    {selectedSession.usage.map((item) => <article key={item.inputId}>
                      <i style={{ background: item.color }} />
                      <div><strong>{item.inputLabel}</strong><span>{item.group} · {formatATEMDuration(item.durationSeconds)}</span></div>
                      <b>{item.percent.toFixed(1)}%</b>
                      <em><span style={{ width: `${item.percent}%`, background: item.color }} /></em>
                    </article>)}
                  </div>
                </section>

                <section className="atem-session-switches">
                  <header><strong>本场切换记录</strong><span>按实际 PGM 切换顺序记录</span></header>
                  <div className="atem-history-list">
                    {selectedSessionSwitches.map((entry) => (
                      <article className="atem-history-row" key={entry.id}>
                        <time>{formatATEMSwitchDate(entry.switchedAt)}</time>
                        <div className="atem-history-route">
                          <span><b>{entry.fromInputLabel}</b><em>PGM {entry.fromInputId}</em></span>
                          <ArrowRight size={16} />
                          <span><b>{entry.toInputLabel}</b><em>PGM {entry.toInputId}</em></span>
                        </div>
                        <strong>停留 {formatATEMDuration(entry.durationSeconds)}</strong>
                      </article>
                    ))}
                    {selectedSessionSwitches.length === 0 && <div className="atem-history-empty">本场尚未发生机位切换。</div>}
                  </div>
                </section>
              </div>
            )}
          </>
        ) : <div className="atem-history-empty">直播或录制开始后，PGM 机位停留时间会按场次记录在这里。</div>}
      </section>}
    </>
  );
}

function formatATEMTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function formatATEMDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分 ${remainder}秒`;
  if (minutes > 0) return `${minutes}分 ${remainder}秒`;
  return `${remainder}秒`;
}

function formatATEMSwitchDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(timestamp);
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

function MonitoringDashboard({ snapshot, search }: { snapshot: NonNullable<ReturnType<typeof useSnapshot>>; search: string }) {
  const query = search.trim().toLowerCase();
  const inputMonitors = snapshot.inputMonitors.filter((input) => !query || input.inputName.toLowerCase().includes(query));
  const recentEvents = snapshot.silenceEvents.filter((entry) => !query || entry.inputName.toLowerCase().includes(query)).slice(0, 8);
  const stats = snapshot.obsStats;
  const skippedFrames = stats.outputSkippedFrames !== null && stats.outputTotalFrames
    ? `${stats.outputSkippedFrames}/${stats.outputTotalFrames}`
    : '--';

  return (
    <div className="monitor-grid">
      <div className="monitor-summary-grid">
        <ConnectionStatusCard snapshot={snapshot} />
        <ProductivityChart history={snapshot.history} />
        <HistoryCalendar history={snapshot.history} />
      </div>
      <section className="monitor-card span-2">
        <div className="monitor-card-title">
          <span><BarChart3 size={18} /> 音量历史</span>
          <em>最近 10 分钟</em>
        </div>
        <VolumeHistoryPanel snapshot={snapshot} query={query} />
      </section>

      <section className="monitor-card">
        <div className="monitor-card-title">
          <span><Gauge size={18} /> OBS 性能</span>
          <em>GetStats</em>
        </div>
        <div className="stat-grid">
          <div><span>CPU</span><strong>{stats.cpuUsage !== null ? `${stats.cpuUsage.toFixed(1)}%` : '--'}</strong></div>
          <div><span>内存</span><strong>{stats.memoryUsageMb !== null ? `${stats.memoryUsageMb.toFixed(0)} MB` : '--'}</strong></div>
          <div><span>FPS</span><strong>{stats.activeFps !== null ? stats.activeFps.toFixed(0) : '--'}</strong></div>
          <div><span>丢帧</span><strong>{skippedFrames}</strong></div>
        </div>
      </section>

      <section className="monitor-card span-2">
        <div className="monitor-card-title">
          <span><Mic2 size={18} /> 音频设备状态</span>
          <em>{inputMonitors.length} 路</em>
        </div>
        <div className="input-monitor-list">
          {inputMonitors.length === 0 ? (
            <div className="empty-block compact">没有匹配的音频源</div>
          ) : inputMonitors.map((input) => (
            <div className={`input-monitor-row ${input.selected ? 'selected' : ''} ${input.status}`} key={input.inputName}>
              <div>
                <strong>{input.inputName}</strong>
                <span>{input.selected ? input.status === 'silent' ? `静音 ${input.silentForSeconds}s` : '已加入检测' : '未加入检测'}</span>
              </div>
              <em>{formatDb(input.lastLevelDb)}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="monitor-card">
        <div className="monitor-card-title">
          <span><ListChecks size={18} /> 静音事件</span>
          <em>本次运行</em>
        </div>
        <div className="silence-event-list">
          {recentEvents.length === 0 ? (
            <div className="empty-block compact">暂无静音事件</div>
          ) : recentEvents.map((entry) => (
            <div className={`silence-event-row ${entry.alertTriggered ? 'alerted' : ''}`} key={entry.id}>
              <strong>{entry.inputName}</strong>
              <span>{new Date(entry.startedAt).toLocaleTimeString()} · {entry.recoveredAt ? `${entry.durationSeconds}s` : '进行中'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function VolumeHistoryPanel({ snapshot, query }: { snapshot: NonNullable<ReturnType<typeof useSnapshot>>; query: string }) {
  const selectedNames = snapshot.config.targetInputNames.length > 0
    ? snapshot.config.targetInputNames
    : snapshot.config.targetInputName
      ? [snapshot.config.targetInputName]
      : [];
  const selectedSet = new Set(selectedNames);
  const selectedMonitors = snapshot.inputMonitors.filter((input) => input.selected);
  const normalCount = selectedMonitors.filter((input) => input.status === 'normal').length;
  const silentCount = selectedMonitors.filter((input) => input.status === 'silent').length;
  const missingCount = selectedMonitors.filter((input) => input.status === 'missing_meter').length;
  const earliestSilent = [...selectedMonitors]
    .filter((input) => input.status === 'silent')
    .sort((a, b) => (a.secondsUntilAlert ?? Number.MAX_SAFE_INTEGER) - (b.secondsUntilAlert ?? Number.MAX_SAFE_INTEGER))[0];
  const sourceNames = selectedNames.length > 0 ? selectedNames : Array.from(new Set(snapshot.volumeHistory.map((point) => point.inputName)));
  const visibleNames = sourceNames
    .filter((name) => !query || name.toLowerCase().includes(query))
    .slice(0, 6);
  const historyPoints = snapshot.volumeHistory
    .filter((point) => visibleNames.includes(point.inputName))
    .slice(-900);

  if (historyPoints.length === 0) {
    return (
      <div className="volume-history-empty">
        <strong>暂无可绘制的音量数据</strong>
        <span>连接 OBS、选择音源并开始直播或模拟开播后，这里会显示每一路音源的电平走势。</span>
      </div>
    );
  }

  const minTime = Math.min(...historyPoints.map((point) => point.timestamp));
  const maxTime = Math.max(...historyPoints.map((point) => point.timestamp));
  const span = Math.max(1, maxTime - minTime);
  const width = 720;
  const height = 180;
  const left = 34;
  const right = 18;
  const top = 16;
  const bottom = 26;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const colors = ['#16A34A', '#2563EB', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2'];
  const yFromDb = (levelDb: number | null) => {
    const safeDb = Math.max(-90, Math.min(0, levelDb ?? -90));
    return top + (1 - (safeDb + 90) / 90) * plotHeight;
  };
  const xFromTime = (timestamp: number) => left + ((timestamp - minTime) / span) * plotWidth;
  const series = visibleNames
    .map((name, index) => {
      // historyPoints is already capped globally. Slicing each series again
      // would leave the x-axis covering the full range while the line only
      // used the final fraction of it, making the graph look stuck on the
      // right side.
      const points = sampleVolumeHistory(historyPoints.filter((point) => point.inputName === name), 240);
      const path = points.map((point, pointIndex) => {
        const x = xFromTime(point.timestamp).toFixed(1);
        const y = yFromDb(point.levelDb).toFixed(1);
        return `${pointIndex === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).join(' ');
      const area = points.length > 0
        ? `${path} L ${xFromTime(points[points.length - 1].timestamp).toFixed(1)} ${top + plotHeight} L ${xFromTime(points[0].timestamp).toFixed(1)} ${top + plotHeight} Z`
        : '';
      const latest = points[points.length - 1]?.levelDb ?? null;
      return { name, color: colors[index % colors.length], points, path, area, latest };
    })
    .filter((item) => item.points.length > 0);

  return (
    <div className="volume-history-panel">
      <div className="multi-source-rule">
        <div>
          <strong>{selectedNames.length > 1 ? `${selectedNames.length} 路独立守护` : selectedNames.length === 1 ? '单路独立守护' : '尚未选择音源'}</strong>
          <span>{selectedNames.length > 0 ? '每一路单独计时，不做平均；任意一路连续静音超时都会报警。' : '请先在设置里选择需要守护的麦克风、声卡或主混音。'}</span>
        </div>
        <div className="multi-source-counts">
          <span className="ok">正常 {normalCount}</span>
          <span className="warn">静音 {silentCount}</span>
          <span>无数据 {missingCount}</span>
        </div>
      </div>

      {earliestSilent && (
        <div className="multi-source-alert-note">
          当前按 <strong>{earliestSilent.inputName}</strong> 计算报警，{earliestSilent.secondsUntilAlert ?? 0}s 后触发。
        </div>
      )}

      <div className="volume-history-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="音量历史折线图" preserveAspectRatio="none">
          <defs>
            {series.map((item, index) => (
              <linearGradient id={`volume-area-${index}`} key={item.name} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={item.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          {[-90, -60, -30, 0].map((db) => (
            <g key={db}>
              <line x1={left} x2={width - right} y1={yFromDb(db)} y2={yFromDb(db)} className="volume-grid-line" />
              <text x={10} y={yFromDb(db) + 4} className="volume-grid-label">{db}</text>
            </g>
          ))}
          {series.map((item, index) => (
            <g key={item.name}>
              <path d={item.area} fill={`url(#volume-area-${index})`} />
              <path d={item.path} fill="none" stroke={item.color} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              {item.points.length > 0 && (
                <circle
                  cx={xFromTime(item.points[item.points.length - 1].timestamp)}
                  cy={yFromDb(item.latest)}
                  r="4.2"
                  fill={item.color}
                  className="volume-latest-dot"
                />
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="volume-history-legend">
        {series.map((item) => {
          const watched = selectedSet.has(item.name);
          return (
            <span key={item.name} className={watched ? 'watched' : ''}>
              <i style={{ background: item.color }} />
              <b>{item.name}</b>
              <em>{formatDb(item.latest)}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function sampleVolumeHistory(points: VolumeHistoryPoint[], maxPoints: number): VolumeHistoryPoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round(index * (points.length - 1) / (maxPoints - 1));
    return points[sourceIndex];
  });
}

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
