import React, { useCallback, useEffect, useState } from 'react';
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

import { Activity, BarChart3, Cable, Download, Gauge, Info, ListChecks, Mic2, TestTube2, Timer, Video } from 'lucide-react';
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
import { ToastAlertApp } from './components/ToastAlertApp';

import { useSnapshot } from './hooks/useSnapshot';
import { useUpdateState } from './hooks/useUpdateState';
import { useAutoSave } from './hooks/useAutoSave';
import { formatDb, shouldShowOnboarding } from './utils/status';
import { APP_VERSION } from './utils/appVersion';

import type { AppConfig, TestConnectionResult } from '../shared/types';

const root = createRoot(document.getElementById('root')!);

const route =
  window.location.hash === '#alert' ? 'alert'
    : window.location.hash === '#toast-alert' ? 'toast-alert'
    : window.location.hash === '#prealert' ? 'prealert'
    : window.location.hash === '#floating' ? 'floating'
    : 'settings';

document.body.dataset.route = route;
document.documentElement.dataset.route = route;

root.render(
  route === 'alert' ? <AlertApp />
    : route === 'toast-alert' ? <ToastAlertApp />
    : route === 'prealert' ? <PreAlertApp />
    : route === 'floating' ? <FloatingApp />
    : <SettingsApp />
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

  const { saveState, scheduleSave, flushSave } = useAutoSave();

  useEffect(() => {
    if (!snapshot) return;
    setDraft((current) => current ?? snapshot.config);
  }, [snapshot]);

  // 切换页面时清空搜索框
  useEffect(() => {
    setSearch('');
  }, [page]);

  // ATEM Beta 应用内快捷键：ATEM 页面中数字键 1-9 选 Preview，Enter 执行 AUTO。
  useEffect(() => {
    if (page !== 'atem' || !snapshot || !snapshot.config.atemEnabled || snapshot.config.atemHotkeyGlobal) return;

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

      {page === 'atem' && (
        <>
          <div className="page-header">
            <div className="page-header-title">
              <h1>
                <span>ATEM 导播台</span>
                <span className="page-title-badge">BETA</span>
              </h1>
              <p className="page-header-subtitle">
                显示当前 PGM / PVW 机位，并支持数字键选择预览机位
              </p>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn-secondary" onClick={() => openSettings('atem')}>
                配置 ATEM
              </button>
              <button type="button" className="btn-primary" onClick={() => void window.obsGuard.atemReconnect()} disabled={!snapshot.config.atemEnabled}>
                重连导播台
              </button>
            </div>
          </div>

          <div className={`atem-workbench ${snapshot.atemConnected ? 'connected' : ''}`}>
            <div className="atem-stage-card program">
              <span>PGM 播出</span>
              <strong>{snapshot.atemProgramInput || '--'}</strong>
              <em>{snapshot.atemInputLabels[snapshot.atemProgramInput] || '未读取到播出机位'}</em>
            </div>
            <div className="atem-stage-card preview">
              <span>PVW 预览</span>
              <strong>{snapshot.atemPreviewInput || '--'}</strong>
              <em>{snapshot.atemInputLabels[snapshot.atemPreviewInput] || '未读取到预览机位'}</em>
            </div>
            <div className="atem-status-card">
              <span>连接状态</span>
              <strong>{snapshot.config.atemEnabled ? (snapshot.atemConnected ? '已连接' : snapshot.atemConnectionState === 'connecting' ? '连接中' : '未连接') : '未启用'}</strong>
              <em>{snapshot.config.atemEnabled ? `地址 ${snapshot.config.atemHost}` : '请先在设置中启用 ATEM Beta'}</em>
            </div>
          </div>

          {!snapshot.config.atemEnabled && (
            <div className="settings-hint warn">
              ATEM Beta 默认不连接硬件。点击“配置 ATEM”后开启连接，并使用“查找导播台”扫描同网段设备。
            </div>
          )}

          {snapshot.config.atemEnabled && !snapshot.atemConnected && (
            <div className="settings-hint warn">
              暂未连接 ATEM。请确认导播台和电脑在同一局域网，或进入设置使用“查找导播台”选择设备 IP。
            </div>
          )}

          {snapshot.atemConnected && snapshot.atemInputCount > 0 && (
            <div className="atem-input-grid">
              {Array.from({ length: snapshot.atemInputCount }, (_, i) => i + 1).map((num) => {
                const isProgram = num === snapshot.atemProgramInput;
                const isPreview = num === snapshot.atemPreviewInput;
                const label = snapshot.atemInputLabels[num] || `Input ${num}`;
                const matchesSearch = !search.trim() || `${num} ${label}`.toLowerCase().includes(search.trim().toLowerCase());
                if (!matchesSearch) return null;
                return (
                  <button
                    type="button"
                    key={num}
                    className={`atem-input-button ${isProgram ? 'program' : isPreview ? 'preview' : ''}`}
                    onClick={() => void window.obsGuard.changePreviewInput(num)}
                  >
                    <span>{num}</span>
                    <strong>{label}</strong>
                    <em>{isProgram ? 'PGM' : isPreview ? 'PVW' : '选为 PVW'}</em>
                  </button>
                );
              })}
              <button type="button" className="atem-auto-button" onClick={() => void window.obsGuard.autoTransition()}>
                AUTO 切换
              </button>
              {snapshot.atemPreviewInput > 0 && (
                <button
                  type="button"
                  className="atem-hardcut-button"
                  onClick={() => {
                    const label = snapshot.atemInputLabels[snapshot.atemPreviewInput] || `Input ${snapshot.atemPreviewInput}`;
                    if (snapshot.config.atemHardCutConfirm && !window.confirm(`确认硬切到 PGM ${snapshot.atemPreviewInput}（${label}）吗？`)) {
                      return;
                    }
                    void window.obsGuard.changeProgramInput(snapshot.atemPreviewInput);
                  }}
                >
                  Hard Cut 到 PVW
                </button>
              )}
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
          searchPlaceholder={page === 'history' ? '搜索报警记录…' : page === 'atem' ? '搜索 ATEM 机位…' : '搜索音源、历史记录…'}
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
      const points = historyPoints.filter((point) => point.inputName === name).slice(-180);
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
