import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BellOff,
  Check,
  CircleHelp,
  CircleDot,
  Clock3,
  History,
  Monitor,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  TestTube2,
  Trash2,
  Volume2,
  Wifi,
  WifiOff
} from 'lucide-react';
import type { AlertAction, AppConfig, AppSnapshot, TestConnectionResult } from '../shared/types';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const route =
  window.location.hash === '#alert'
    ? 'alert'
    : window.location.hash === '#prealert'
      ? 'prealert'
      : window.location.hash === '#floating'
        ? 'floating'
        : 'settings';

root.render(
  <React.StrictMode>
    {route === 'alert' ? <AlertApp /> : route === 'prealert' ? <PreAlertApp /> : route === 'floating' ? <FloatingApp /> : <SettingsApp />}
  </React.StrictMode>
);

function SettingsApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.obsGuard.getSnapshot().then((next) => {
      if (!mounted) {
        return;
      }
      setSnapshot(next);
      setDraft(next.config);
      setShowGuide(!next.config.hasSeenGuide);
    });

    const dispose = window.obsGuard.onSnapshot((next) => {
      setSnapshot(next);
      setDraft((current) => current ?? next.config);
    });

    return () => {
      mounted = false;
      dispose();
    };
  }, []);

  const levelPercent = useMemo(() => {
    if (snapshot?.lastLevelDb === null || snapshot?.lastLevelDb === undefined) {
      return 0;
    }

    return Math.max(0, Math.min(100, ((snapshot.lastLevelDb + 90) / 90) * 100));
  }, [snapshot?.lastLevelDb]);

  if (!snapshot || !draft) {
    return <div className="boot-screen">正在启动 OBS 音频守卫...</div>;
  }

  const save = async () => {
    setSaving(true);
    try {
      const next = await window.obsGuard.saveConfig(draft);
      setSnapshot(next);
      setDraft(next.config);
    } finally {
      setSaving(false);
    }
  };

  const closeGuide = async () => {
    setShowGuide(false);
    if (!snapshot.config.hasSeenGuide) {
      const next = await window.obsGuard.saveConfig({ hasSeenGuide: true });
      setSnapshot(next);
      setDraft(next.config);
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      setTestResult(await window.obsGuard.testConnection(draft));
    } finally {
      setTestingConnection(false);
    }
  };

  const updateDraft = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <div className="eyebrow">OBS Audio Guard</div>
          <h1>OBS 音频守卫</h1>
        </div>
        <StatusPill snapshot={snapshot} />
      </section>

      <SafetyBanner snapshot={snapshot} />

      <section className="dashboard-grid">
        <div className="panel status-panel">
          <div className="panel-title">
            <CircleDot size={18} />
            <span>实时检测</span>
          </div>
          <div className="meter-wrap">
            <div className="meter-header">
              <span>{draft.targetInputName || '未选择音源'}</span>
              <strong>{snapshot.lastLevelDb === null ? '--' : `${snapshot.lastLevelDb.toFixed(1)} dB`}</strong>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${levelPercent}%` }} />
              <div className="threshold-marker" style={{ left: `${Math.max(0, Math.min(100, ((draft.silenceThresholdDb + 90) / 90) * 100))}%` }} />
            </div>
          </div>
          <div className="status-cards">
            <Metric label="直播" value={snapshot.streaming ? '进行中' : '未开始'} active={snapshot.streaming} />
            <Metric label="录制" value={snapshot.recording ? '进行中' : '未开始'} active={snapshot.recording} />
            <Metric
              label="静音计时"
              value={snapshot.secondsUntilAlert === null ? `${snapshot.silentForSeconds}s` : `${snapshot.secondsUntilAlert}s 后报警`}
              active={snapshot.status === 'silent_counting'}
            />
          </div>
          {snapshot.errorMessage && <div className="inline-warning">{snapshot.errorMessage}</div>}
        </div>

        <div className="panel action-panel">
          <div className="panel-title">
            <Settings size={18} />
            <span>快捷操作</span>
          </div>
          <div className="action-row">
            <button className={snapshot.config.paused ? 'primary' : 'secondary'} onClick={() => void window.obsGuard.setPaused(!snapshot.config.paused)}>
              {snapshot.config.paused ? <Play size={18} /> : <Pause size={18} />}
              {snapshot.config.paused ? '恢复检测' : '暂停检测'}
            </button>
            <button className="secondary" onClick={() => void window.obsGuard.reconnect()}>
              <RefreshCw size={18} />
              重连 OBS
            </button>
          </div>
          <button className="ghost full" onClick={() => void testConnection()} disabled={testingConnection}>
            <TestTube2 size={17} />
            {testingConnection ? '测试中...' : '测试连接'}
          </button>
          <button className="ghost full" onClick={() => void window.obsGuard.refreshInputs()}>
            <RefreshCw size={17} />
            刷新音源列表
          </button>
          <button className="ghost full" onClick={() => void window.obsGuard.testAlert()}>
            <AlertTriangle size={17} />
            测试报警弹窗
          </button>
          <button className="ghost full" onClick={() => void window.obsGuard.setFloatingWindowVisible(!snapshot.config.floatingWindowEnabled)}>
            <Monitor size={17} />
            {snapshot.config.floatingWindowEnabled ? '关闭小浮窗' : '打开小浮窗'}
          </button>
          <button className="ghost full" onClick={() => setShowGuide(true)}>
            <CircleHelp size={17} />
            操作说明
          </button>
          {testResult && (
            <div className={`connection-result ${testResult.ok ? 'ok' : 'bad'}`}>
              {testResult.message}
            </div>
          )}
        </div>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <div className="panel-title">
            <Wifi size={18} />
            <span>OBS 连接</span>
          </div>
          <div className="form-grid two">
            <label>
              <span>主机</span>
              <input value={draft.obsHost} onChange={(event) => updateDraft('obsHost', event.target.value)} />
            </label>
            <label>
              <span>端口</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={draft.obsPort}
                onChange={(event) => updateDraft('obsPort', numberFromInput(event.target.value, draft.obsPort))}
              />
            </label>
            <label className="span-two">
              <span>WebSocket 密码</span>
              <input type="password" value={draft.obsPassword} onChange={(event) => updateDraft('obsPassword', event.target.value)} placeholder="未设置密码可留空" />
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <Volume2 size={18} />
            <span>检测规则</span>
          </div>
          <div className="form-grid two">
            <label className="span-two">
              <span>目标音源</span>
              <select value={draft.targetInputName} onChange={(event) => updateDraft('targetInputName', event.target.value)}>
                <option value="">选择 OBS 输入源</option>
                {snapshot.inputs.map((input) => (
                  <option value={input.inputName} key={`${input.inputKind}:${input.inputName}`}>
                    {input.inputName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>静音时长（秒）</span>
              <input
                type="number"
                min={5}
                max={3600}
                value={draft.silenceDurationSeconds}
                onChange={(event) => updateDraft('silenceDurationSeconds', numberFromInput(event.target.value, draft.silenceDurationSeconds))}
              />
            </label>
            <label>
              <span>静音阈值（dB）</span>
              <input
                type="number"
                min={-90}
                max={-5}
                value={draft.silenceThresholdDb}
                onChange={(event) => updateDraft('silenceThresholdDb', numberFromInput(event.target.value, draft.silenceThresholdDb))}
              />
            </label>
          </div>
        </div>

        <div className="panel span-two">
          <div className="panel-title">
            <Monitor size={18} />
            <span>报警窗口</span>
          </div>
          <div className="display-options">
            <Segment
              active={draft.alertDisplayMode === 'primary'}
              icon={<Monitor size={17} />}
              label="主屏中央"
              onClick={() => updateDraft('alertDisplayMode', 'primary')}
            />
            <Segment
              active={draft.alertDisplayMode === 'display_id'}
              icon={<Monitor size={17} />}
              label="指定屏幕"
              onClick={() => updateDraft('alertDisplayMode', 'display_id')}
            />
            <Segment
              active={draft.alertDisplayMode === 'all'}
              icon={<Radio size={17} />}
              label="所有屏幕"
              onClick={() => updateDraft('alertDisplayMode', 'all')}
            />
          </div>
          {draft.alertDisplayMode === 'display_id' && (
            <label className="display-picker">
              <span>弹出屏幕</span>
              <select value={draft.alertDisplayId ?? ''} onChange={(event) => updateDraft('alertDisplayId', event.target.value ? Number(event.target.value) : null)}>
                <option value="">选择屏幕</option>
                {snapshot.displays.map((display) => (
                  <option value={display.id} key={display.id}>
                    {display.label} - {display.bounds.width}x{display.bounds.height}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="panel span-two">
          <div className="panel-title history-title">
            <span>
              <History size={18} />
              <span>报警历史</span>
            </span>
            <button className="ghost mini" onClick={() => void window.obsGuard.clearHistory()}>
              <Trash2 size={15} />
              清空
            </button>
          </div>
          <HistoryList snapshot={snapshot} />
        </div>
      </section>

      <footer className="footer-actions">
        <div>默认仅在直播或录制中检测，OBS 空闲时不会报警。</div>
        <button className="primary" onClick={save} disabled={saving}>
          <Save size={18} />
          {saving ? '保存中...' : '保存设置'}
        </button>
      </footer>

      {showGuide && (
        <GuideDialog
          onClose={() => void closeGuide()}
          onTestConnection={() => void testConnection()}
          testResult={testResult}
          testingConnection={testingConnection}
        />
      )}
    </main>
  );
}

function AlertApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [closingAction, setClosingAction] = useState<AlertAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  const sendAction = useCallback(
    async (action: AlertAction) => {
      if (closingAction) {
        return;
      }

      setClosingAction(action);
      setError(null);

      try {
        await window.obsGuard.alertAction(action);
      } catch (err) {
        setError('关闭失败，正在尝试强制关闭。');
        try {
          await window.obsGuard.forceCloseAlert();
        } catch {
          setError(err instanceof Error ? err.message : '关闭失败，请从托盘退出后重开。');
          setClosingAction(null);
        }
      }
    },
    [closingAction]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        void sendAction('acknowledge');
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sendAction]);

  if (!snapshot) {
    return null;
  }

  return (
    <main className="alert-shell">
      <div className="alert-icon">
        <AlertTriangle size={32} />
      </div>
      <section className="alert-copy">
        <div className="alert-kicker">音频静音提醒</div>
        <h1>{snapshot.config.targetInputName || '目标音源'} 可能没有声音</h1>
        <p>已连续静音 {snapshot.silentForSeconds} 秒，请确认麦克风、声卡或 OBS 音频路由。</p>
      </section>
      <section className="alert-actions">
        <button className="quiet" onClick={() => void sendAction('ignore_once')} disabled={closingAction !== null}>
          <BellOff size={17} />
          {closingAction === 'ignore_once' ? '处理中...' : '单次忽略'}
        </button>
        <button className="confirm" onClick={() => void sendAction('acknowledge')} disabled={closingAction !== null}>
          <Check size={18} />
          {closingAction === 'acknowledge' ? '关闭中...' : '确定'}
        </button>
      </section>
      {error && <div className="alert-error">{error}</div>}
    </main>
  );
}

function PreAlertApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  if (!snapshot) {
    return null;
  }

  return (
    <main className="prealert-shell">
      <button
        className="prealert-close"
        aria-label="关闭本次预警"
        disabled={dismissing}
        onClick={() => {
          setDismissing(true);
          void window.obsGuard.dismissPreAlert().catch(() => setDismissing(false));
        }}
      >
        ×
      </button>
      <div className="prealert-icon">
        <Clock3 size={24} />
      </div>
      <section>
        <div className="prealert-kicker">静音预警</div>
        <strong>{snapshot.config.targetInputName || '目标音源'} 已静音 {snapshot.silentForSeconds} 秒</strong>
        <p>约 {snapshot.preAlertRemainingSeconds ?? 0} 秒后触发正式报警</p>
      </section>
    </main>
  );
}

function FloatingApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    void window.obsGuard.getSnapshot().then(setSnapshot);
    return window.obsGuard.onSnapshot(setSnapshot);
  }, []);

  if (!snapshot) {
    return null;
  }

  const tone = snapshotTone(snapshot);
  const levelPercent = dbLevelPercent(snapshot.lastLevelDb);

  return (
    <main className={`floating-shell ${tone}`}>
      <header className="floating-header">
        <div className="floating-status">
          <span />
          <strong>{statusText(snapshot.status)}</strong>
        </div>
        <div className="floating-window-actions">
          <button aria-label="打开设置" onClick={() => void window.obsGuard.showSettings()}>
            <Settings size={15} />
          </button>
          <button aria-label="关闭小浮窗" onClick={() => void window.obsGuard.setFloatingWindowVisible(false)}>
            ×
          </button>
        </div>
      </header>

      <section className="floating-time">
        <span>静音时间</span>
        <strong>{snapshot.silentForSeconds}s</strong>
        <em>{floatingHint(snapshot)}</em>
      </section>

      <section className="floating-meter">
        <div>
          <span>{snapshot.config.targetInputName || '未选择音源'}</span>
          <strong>{snapshot.lastLevelDb === null ? '--' : `${snapshot.lastLevelDb.toFixed(1)} dB`}</strong>
        </div>
        <div className="floating-meter-track">
          <div style={{ width: `${levelPercent}%` }} />
        </div>
      </section>

      <footer className="floating-footer">
        <span>{snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
        <button onClick={() => void window.obsGuard.setPaused(!snapshot.config.paused)}>
          {snapshot.config.paused ? <Play size={14} /> : <Pause size={14} />}
          {snapshot.config.paused ? '恢复' : '暂停'}
        </button>
      </footer>
    </main>
  );
}

function SafetyBanner({ snapshot }: { snapshot: AppSnapshot }) {
  const tone = snapshotTone(snapshot);

  return (
    <section className={`safety-banner ${tone}`}>
      <div className="safety-icon">
        {tone === 'safe' ? <ShieldCheck size={28} /> : tone === 'warning' ? <Clock3 size={28} /> : <AlertTriangle size={28} />}
      </div>
      <div>
        <div className="safety-label">{safetyTitle(snapshot)}</div>
        <p>{readinessText(snapshot)}</p>
      </div>
      <div className="safety-meta">
        <span>{snapshot.streaming ? '直播中' : snapshot.recording ? '录制中' : '未开播'}</span>
        <strong>{snapshot.config.targetInputName || '未选择音源'}</strong>
      </div>
    </section>
  );
}

function HistoryList({ snapshot }: { snapshot: AppSnapshot }) {
  if (snapshot.history.length === 0) {
    return <div className="empty-history">暂无报警记录</div>;
  }

  return (
    <div className="history-list">
      {snapshot.history.map((entry) => (
        <div className="history-item" key={entry.id}>
          <div>
            <strong>{entry.inputName}</strong>
            <span>{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div>
            <strong>{entry.silentForSeconds}s</strong>
            <span>{entry.action === 'acknowledge' ? '确定' : '单次忽略'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function GuideDialog({
  onClose,
  onTestConnection,
  testResult,
  testingConnection
}: {
  onClose: () => void;
  onTestConnection: () => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="guide-dialog">
        <div className="guide-header">
          <div>
            <div className="eyebrow">Setup Guide</div>
            <h2>操作说明</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭操作说明">
            <Check size={19} />
          </button>
        </div>

        <div className="guide-steps">
          <article>
            <strong>1. 打开 OBS WebSocket</strong>
            <p>在 OBS 里进入“工具”到“WebSocket 服务器设置”，启用 WebSocket。默认端口一般是 4455，如果设置了密码，就在本软件里填同一个密码。</p>
          </article>
          <article>
            <strong>2. 连接并选择音源</strong>
            <p>保存 OBS 主机、端口和密码后，点击“刷新音源列表”，选择要监听的麦克风或声音源。</p>
          </article>
          <article>
            <strong>3. 设置报警规则</strong>
            <p>默认连续静音 120 秒报警，阈值默认 -55 dB。你可以按直播间环境调整静音时长和阈值。</p>
          </article>
          <article>
            <strong>4. 测试弹窗</strong>
            <p>点击“测试报警弹窗”检查位置和样式。实际检测只会在 OBS 正在直播或录制时开始。</p>
          </article>
          <article>
            <strong>5. 后台运行和退出</strong>
            <p>点窗口关闭按钮只会隐藏到后台。需要彻底退出时，从右下角托盘图标菜单选择“退出”。</p>
          </article>
        </div>

        <div className="guide-test">
          <button className="secondary" onClick={onTestConnection} disabled={testingConnection}>
            <TestTube2 size={17} />
            {testingConnection ? '测试中...' : '测试 OBS 连接'}
          </button>
          {testResult && <span className={testResult.ok ? 'test-ok' : 'test-bad'}>{testResult.message}</span>}
        </div>

        <button className="primary guide-close" onClick={onClose}>
          <Check size={18} />
          我知道了
        </button>
      </section>
    </div>
  );
}

function safetyTitle(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '正在报警';
  }

  if (snapshot.preAlertVisible) {
    return '静音预警中';
  }

  if (snapshot.readinessReason === 'ready') {
    return '当前安全';
  }

  return '尚未进入检测';
}

function readinessText(snapshot: AppSnapshot): string {
  const reasonText: Record<string, string> = {
    ready: snapshot.secondsUntilAlert === null ? '音源电平正常，正在守护直播间音频。' : `已静音 ${snapshot.silentForSeconds} 秒，距离报警 ${snapshot.secondsUntilAlert} 秒。`,
    obs_disconnected: 'OBS 未连接，请确认 OBS 已打开且 WebSocket 已启用。',
    obs_connecting: '正在连接 OBS WebSocket。',
    not_streaming_or_recording: 'OBS 当前未直播或录制，暂不检测。',
    no_target_selected: '请选择需要监听的 OBS 音频源。',
    target_missing: '目标音源不在 OBS 输入源列表中，请刷新或重新选择。',
    no_target_meter: '暂时没有收到目标音源电平数据，请确认该源处于活动状态。',
    paused: '检测已手动暂停。',
    snoozed: snapshot.snoozedUntil ? `已延后检测，将在 ${new Date(snapshot.snoozedUntil).toLocaleTimeString()} 后恢复。` : '已延后检测。',
    alerting: '目标音源静音超时，请处理报警弹窗。',
    error: snapshot.errorMessage ?? '检测状态异常。'
  };

  return reasonText[snapshot.readinessReason] ?? '正在读取状态。';
}

function StatusPill({ snapshot }: { snapshot: AppSnapshot }) {
  const connected = snapshot.connected;
  return (
    <div className={`status-pill ${connected ? 'online' : 'offline'}`}>
      {connected ? <Wifi size={17} /> : <WifiOff size={17} />}
      {statusText(snapshot.status)}
    </div>
  );
}

function Metric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`metric ${active ? 'active' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Segment({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`segment ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    disconnected: 'OBS 未连接',
    connecting: '正在连接 OBS',
    idle_not_streaming: '等待直播/录制',
    monitoring: '检测中',
    silent_counting: '静音计时中',
    pre_alert: '静音预警中',
    alerting: '正在提醒',
    snoozed: '已延后检测',
    ignored_until_audio_returns: '本次已忽略',
    paused: '检测已暂停',
    error: '状态异常'
  };

  return labels[status] ?? status;
}

function numberFromInput(value: string, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function dbLevelPercent(levelDb: number | null): number {
  if (levelDb === null) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((levelDb + 90) / 90) * 100));
}

function snapshotTone(snapshot: AppSnapshot): 'safe' | 'warning' | 'danger' | 'idle' {
  if (snapshot.alertVisible) {
    return 'danger';
  }

  if (snapshot.preAlertVisible) {
    return 'warning';
  }

  return snapshot.readinessReason === 'ready' ? 'safe' : 'idle';
}

function floatingHint(snapshot: AppSnapshot): string {
  if (snapshot.alertVisible) {
    return '已触发报警';
  }

  if (snapshot.secondsUntilAlert !== null) {
    return `${snapshot.secondsUntilAlert}s 后报警`;
  }

  if (snapshot.readinessReason === 'ready') {
    return '音频正常';
  }

  return readinessText(snapshot);
}
