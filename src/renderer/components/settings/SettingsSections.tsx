import React from 'react';
import {
  AlertTriangle,
  BellOff,
  BookOpen,
  Cable,
  Cloud,
  Download,
  Globe2,
  History,
  Info,
  Mic2,
  Monitor,
  Play,
  Power,
  RefreshCw,
  Route,
  TestTube2,
  Timer,
  Trash2,
  Video
} from 'lucide-react';
import type { AppConfig, AppSnapshot, ATEMScanResult, ATEMTestResult, TestConnectionResult, UpdateSnapshot } from '../../../shared/types';
import { snapshotTargetName } from '../../utils/status';
import { NumberField, SegmentedControl, ToggleRow } from './widgets';
import { SourcePicker } from './SourcePicker';

interface SectionProps {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ icon: Icon, title, description, id, children }) => (
  <section className="settings-section" id={id}>
    <div className="settings-section-title">
      <span className="settings-section-title-icon"><Icon size={18} /></span>
      <div>
        <strong>{title}</strong>
        {description && <em>{description}</em>}
      </div>
    </div>
    {children}
  </section>
);

// ====== 1. OBS 连接 ======
export const ConnectionSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => (
  <Section id="settings-connection" icon={Cable} title="OBS 连接" description="WebSocket 地址与密码">
    <div className="settings-field">
      <label className="settings-field-label" htmlFor="conn-host">主机</label>
      <input id="conn-host" className="input" value={draft.obsHost} onChange={(e) => onChange('obsHost', e.target.value)} placeholder="127.0.0.1" />
    </div>
    <div className="settings-field-row">
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="conn-port">端口</label>
        <NumberField value={draft.obsPort} min={1} max={65535} step={1} onChange={(v) => onChange('obsPort', v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="conn-pwd">WebSocket 密码</label>
        <input id="conn-pwd" className="input" type="password" value={draft.obsPassword} onChange={(e) => onChange('obsPassword', e.target.value)} placeholder="未设置密码可留空" />
      </div>
    </div>
    <div className={`settings-hint ${snapshot.connected ? '' : 'warn'}`}>
      {snapshot.connected
        ? snapshot.simulatedLive ? '当前为模拟开播检测' : '已能读取 OBS 状态和可检测音频源'
        : '请确认 OBS 已打开,且 WebSocket 已启用'}
    </div>
  </Section>
);

// ====== ATEM 导播台 (beta) ======
export const ATEMSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => {
  const [testing, setTesting] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [testResult, setTestResult] = React.useState<ATEMTestResult | null>(null);
  const [scanResult, setScanResult] = React.useState<ATEMScanResult | null>(null);

  const handleTestConnection = React.useCallback(async () => {
    if (!draft.atemHost) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.obsGuard.testATEMConnection(draft.atemHost);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }, [draft.atemHost]);

  const handleScanNetwork = React.useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await window.obsGuard.scanATEMNetwork(draft.atemHost);
      setScanResult(result);
    } finally {
      setScanning(false);
    }
  }, [draft.atemHost]);

  const handleReconnect = React.useCallback(async () => {
    await window.obsGuard.atemReconnect();
  }, []);

  const connectionStatusLabel = () => {
    if (snapshot.atemConnectionState === 'connecting') return { text: '正在连接…', tone: '' };
    if (snapshot.atemConnectionState === 'error') return { text: '连接失败', tone: 'warn' };
    if (snapshot.atemConnected) return { text: '已连接', tone: '' };
    return { text: '未连接', tone: 'warn' };
  };

  const status = connectionStatusLabel();

  return (
    <Section id="settings-atem" icon={Video} title="ATEM 导播台" description="通过网络连接 Blackmagic ATEM 切换台">
      <div className="settings-section-title-beta">
        <span className="beta-badge">BETA</span>
      </div>
      <ToggleRow
        id="atem-enabled"
        title="启用 ATEM 连接"
        description="连接 ATEM 切换台以显示当前机位号并支持快捷键切台"
        checked={draft.atemEnabled}
        onChange={(v) => onChange('atemEnabled', v)}
      />
      {draft.atemEnabled && (
        <>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="atem-host">ATEM IP 地址</label>
            <div className="settings-inline-row">
              <input
                id="atem-host"
                className="input settings-inline-row-main"
                value={draft.atemHost}
                onChange={(e) => { onChange('atemHost', e.target.value); setTestResult(null); }}
                placeholder="192.168.1.240"
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleTestConnection()}
                disabled={testing || !draft.atemHost}
              >
                <RefreshCw size={14} className={testing ? 'spin' : ''} />
                {testing ? '检测中…' : '检测连接'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleScanNetwork()}
                disabled={scanning}
              >
                <Route size={14} className={scanning ? 'spin' : ''} />
                {scanning ? '查找中…' : '查找导播台'}
              </button>
            </div>
          </div>

          {testResult && (
            <div className={`diagnostic-result ${testResult.ok ? 'ok' : 'bad'}`}>
              {testResult.message}
            </div>
          )}

          {(scanning || scanResult) && (
            <div className={`diagnostic-result ${scanResult?.ok ? 'ok' : scanning ? 'pending' : 'bad'}`}>
              {scanning ? '正在扫描本机局域网中的 ATEM 导播台…' : scanResult?.message}
              {scanResult && (
                <span className="atem-scan-meta"> 已扫描 {scanResult.scannedHosts} 个地址{scanResult.interfaces.length > 0 ? ` · ${scanResult.interfaces.join(' / ')}` : ''}</span>
              )}
            </div>
          )}

          {scanResult && scanResult.devices.length > 0 && (
            <div className="atem-discovery-list">
              {scanResult.devices.map((device) => (
                <button
                  type="button"
                  key={device.host}
                  className={`atem-device-card ${device.host === draft.atemHost ? 'active' : ''}`}
                  onClick={() => {
                    onChange('atemHost', device.host);
                    setTestResult({
                      ok: true,
                      message: device.message,
                      inputCount: device.inputCount,
                      modelName: device.modelName
                    });
                  }}
                >
                  <span>
                    <strong>{device.label}</strong>
                    <em>{device.network || '局域网'}{device.interfaceName ? ` · ${device.interfaceName}` : ''}</em>
                  </span>
                  <b>{device.inputCount || '--'} 路</b>
                </button>
              ))}
            </div>
          )}

          <div className={`settings-hint ${status.tone} atem-status-hint`}>
            <span>
              <span
                className={`atem-status-dot ${
                  snapshot.atemConnected
                    ? 'connected'
                    : snapshot.atemConnectionState === 'connecting'
                      ? 'connecting'
                      : snapshot.atemConnectionState === 'error'
                        ? 'error'
                        : ''
                }`}
              />
              {status.text}
              {snapshot.atemConnected && (
                <> · PGM {snapshot.atemProgramInput}{snapshot.atemInputLabels[snapshot.atemProgramInput] ? ` (${snapshot.atemInputLabels[snapshot.atemProgramInput]})` : ''} · 共 {snapshot.atemInputCount} 路</>
              )}
              {!snapshot.atemConnected && snapshot.atemConnectionState !== 'connecting' && (
                <> — 请确认 IP 地址正确且 ATEM 与电脑在同一网络</>
              )}
            </span>
            {(snapshot.atemConnectionState === 'error' || (!snapshot.atemConnected && snapshot.atemConnectionState === 'disconnected')) && (
              <button type="button" className="btn-ghost" onClick={() => void handleReconnect()}>
                <RefreshCw size={12} /> 重连
              </button>
            )}
          </div>

          <ToggleRow
            id="atem-hotkey-global"
            title="全局快捷键"
            description="启用后数字键盘(Num1-9)可在任何应用中选 Preview 机位，Enter 执行 AUTO 切换"
            checked={draft.atemHotkeyGlobal}
            onChange={(v) => onChange('atemHotkeyGlobal', v)}
          />
          <ToggleRow
            id="atem-hardcut-confirm"
            title="硬切确认保护"
            description="执行 Hard Cut 前需要二次确认，避免直播中误切到错误机位"
            checked={draft.atemHardCutConfirm}
            onChange={(v) => onChange('atemHardCutConfirm', v)}
          />
          <ToggleRow
            id="atem-camera-timer"
            title="机位超时提醒"
            description="当同一个 PGM 机位停留超过设定时间，在 ATEM 面板和小浮窗中提示"
            checked={draft.atemCameraTimeAlertEnabled}
            onChange={(v) => onChange('atemCameraTimeAlertEnabled', v)}
          />
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="atem-camera-limit">单机位提醒时长</label>
            <NumberField
              value={draft.atemCameraTimeLimitSeconds}
              min={10}
              max={3600}
              step={10}
              suffix="秒"
              onChange={(v) => onChange('atemCameraTimeLimitSeconds', v)}
            />
          </div>

          {snapshot.atemConnected && snapshot.atemInputCount > 0 && (
            <div className="atem-input-list">
              {Array.from({ length: snapshot.atemInputCount }, (_, i) => i + 1).map((num) => {
                const label = snapshot.atemInputLabels[num];
                const isProgram = num === snapshot.atemProgramInput;
                const isPreview = num === snapshot.atemPreviewInput;
                return (
                  <span
                    key={num}
                    className={`atem-input-chip ${isProgram ? 'program' : isPreview ? 'preview' : ''}`}
                  >
                    <span className="atem-input-dot" />
                    {num}{label ? ` ${label}` : ''}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </Section>
  );
};

// ====== 2. 目标音源 ======
export const AudioSourceSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => (
  <Section id="settings-source" icon={Mic2} title="目标音源" description="选择需要守护的 OBS 音频源">
    <div className="settings-field">
      <label className="settings-field-label">音源</label>
      <SourcePicker
        inputs={snapshot.inputs}
        value={draft.targetInputName}
        values={draft.targetInputNames}
        onChange={(v) => onChange('targetInputName', v)}
        onChangeMany={(v) => {
          onChange('targetInputNames', v);
          onChange('targetInputName', v[0] ?? '');
        }}
        onRefresh={() => void window.obsGuard.refreshInputs()}
      />
    </div>
    <p className="settings-section-hint">
      可同时选择主播、嘉宾、场外麦或直播主混音。任一被选中音源连续静音超时都会报警；图片、文字、显示器采集等无声音源已被自动过滤。
    </p>
  </Section>
);

// ====== 3. 报警规则 ======
export const RulesSection: React.FC<{
  draft: AppConfig;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, onChange }) => (
  <Section id="settings-rules" icon={Timer} title="报警规则" description="连续静音达到时长后报警">
    <div className="settings-field-row">
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="rule-duration">静音时长</label>
        <NumberField value={draft.silenceDurationSeconds} min={5} max={3600} step={5} suffix="秒" onChange={(v) => onChange('silenceDurationSeconds', v)} />
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="rule-threshold">静音阈值</label>
        <NumberField value={draft.silenceThresholdDb} min={-90} max={-5} step={1} suffix="dB" onChange={(v) => onChange('silenceThresholdDb', v)} />
      </div>
    </div>
    <p className="settings-section-hint">
      默认 120 秒报警,90 秒先预警。口播密集可缩短静音时长,访谈或活动直播可适当延长。阈值拖动也可在主界面电平表上完成。
    </p>
    <div className="settings-field">
      <span className="settings-field-label">正式报警样式</span>
      <SegmentedControl
        value={draft.alertReminderMode}
        onChange={(v) => onChange('alertReminderMode', v)}
        options={[
          { value: 'classic', label: '经典弹窗', icon: <AlertTriangle size={13} /> },
          { value: 'toast', label: '小红窗增强', icon: <AlertTriangle size={13} /> },
          { value: 'both', label: '双重提醒', icon: <AlertTriangle size={13} /> }
        ]}
      />
    </div>
    <ToggleRow
      id="rule-alert-sound"
      title="声音提示"
      description="正式报警时通过系统默认扬声器播放一声提示音"
      checked={draft.alertSoundEnabled}
      onChange={(v) => onChange('alertSoundEnabled', v)}
    />
    <ToggleRow
      id="rule-prealert"
      title="报警前预警"
      description="达到正式报警时长前先显示黄色小浮窗提示"
      checked={draft.preAlertEnabled}
      onChange={(v) => onChange('preAlertEnabled', v)}
    />
    <div className="settings-field">
      <label className="settings-field-label" htmlFor="rule-prealert-ratio">预警触发比例</label>
      <NumberField
        value={Math.round((draft.preAlertRatio ?? 0.75) * 100)}
        min={50}
        max={95}
        step={5}
        suffix="%"
        onChange={(v) => onChange('preAlertRatio', v / 100)}
      />
    </div>
  </Section>
);

// ====== 4. 报警窗口位置(仅多屏) ======
export const DisplaySection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => {
  if (snapshot.displays.length <= 1) {
    return (
      <Section id="settings-display" icon={Monitor} title="报警窗口位置" description="多屏直播时指定报警出现位置">
        <div className="settings-hint">当前只检测到 1 个屏幕，报警默认显示在当前屏幕中央。</div>
      </Section>
    );
  }
  return (
    <Section id="settings-display" icon={Monitor} title="报警窗口位置" description="多屏直播时指定报警出现位置">
      <SegmentedControl
        value={draft.alertDisplayMode}
        onChange={(v) => onChange('alertDisplayMode', v)}
        options={[
          { value: 'primary', label: '主屏中央', icon: <Monitor size={13} /> },
          { value: 'display_id', label: '指定屏幕', icon: <Monitor size={13} /> },
          { value: 'all', label: '所有屏幕', icon: <Monitor size={13} /> }
        ]}
      />
      {draft.alertDisplayMode === 'display_id' && (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="display-id">弹出屏幕</label>
          <select
            id="display-id"
            className="input"
            value={draft.alertDisplayId ?? ''}
            onChange={(e) => onChange('alertDisplayId', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">选择屏幕</option>
            {snapshot.displays.map((display) => (
              <option value={display.id} key={display.id}>
                {display.label} - {display.bounds.width}x{display.bounds.height}
              </option>
            ))}
          </select>
        </div>
      )}
      <ToggleRow
        id="display-remember-position"
        title="记住报警窗口位置"
        description="拖动报警弹窗后，下次在同一屏幕优先使用上次位置"
        checked={draft.rememberAlertPosition}
        onChange={(v) => onChange('rememberAlertPosition', v)}
      />
    </Section>
  );
};

// ====== 5. 系统 ======
export const SystemSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => (
  <Section id="settings-system" icon={Power} title="窗口与后台" description="浮窗、后台运行和开机自启">
    <ToggleRow
      id="system-floating"
      title="小浮窗置顶显示"
      description={draft.floatingWindowEnabled ? '当前已在桌面显示状态浮窗' : '适合直播中放在屏幕角落持续观察'}
      checked={draft.floatingWindowEnabled}
      onChange={(v) => onChange('floatingWindowEnabled', v)}
    />
    <ToggleRow
      id="system-autolaunch"
      title="开机自动启动"
      description="开机后在后台运行,直播前无需手动打开"
      checked={draft.autoLaunch}
      onChange={(v) => onChange('autoLaunch', v)}
    />
    <div className="settings-subgroup">
      <div className="settings-subgroup-title">小浮窗显示内容</div>
      <ToggleRow
        id="floating-module-audio"
        title="音频状态"
        description="显示当前检测状态、静音倒计时和电平"
        checked={draft.floatingWindowModules.audio}
        onChange={(v) => onChange('floatingWindowModules', { ...draft.floatingWindowModules, audio: v })}
      />
      <ToggleRow
        id="floating-module-atem"
        title="ATEM 当前机位"
        description="显示 PGM 机位和当前机位持续时间"
        checked={draft.floatingWindowModules.atem}
        onChange={(v) => onChange('floatingWindowModules', { ...draft.floatingWindowModules, atem: v })}
      />
      <ToggleRow
        id="floating-module-stats"
        title="OBS 性能摘要"
        description="显示 FPS 和 CPU 使用率"
        checked={draft.floatingWindowModules.obsStats}
        onChange={(v) => onChange('floatingWindowModules', { ...draft.floatingWindowModules, obsStats: v })}
      />
    </div>
    <p className="settings-section-hint">
      当前检测到 {snapshot.displays.length} 个屏幕。关闭主窗口后软件仍会在托盘或菜单栏后台运行。
    </p>
  </Section>
);

// ====== 6. 诊断测试 ======
export const DiagnosticsSection: React.FC<{
  snapshot: AppSnapshot;
  testingConnection: boolean;
  testResult: TestConnectionResult | null;
  onTestConnection: () => void;
  onOpenManual: () => void;
  onReset: () => void;
}> = ({ snapshot, testingConnection, testResult, onTestConnection, onOpenManual, onReset }) => (
  <Section id="settings-diagnostics" icon={TestTube2} title="诊断测试" description="本地调试与维护工具">
    <div className="diagnostics-grid">
      <button type="button" className={`diagnostic-item ${snapshot.simulatedLive ? 'active' : ''}`} onClick={() => void window.obsGuard.setSimulatedLive(!snapshot.simulatedLive)}>
        <span className="diagnostic-item-icon"><Play size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">{snapshot.simulatedLive ? '关闭模拟开播' : '模拟开播检测'}</span>
          <span className="diagnostic-item-sub">OBS 未推流时测试静音逻辑</span>
        </span>
      </button>

      <button type="button" className="diagnostic-item" onClick={onTestConnection} disabled={testingConnection}>
        <span className="diagnostic-item-icon"><TestTube2 size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">{testingConnection ? '测试中…' : '测试 OBS 连接'}</span>
          <span className="diagnostic-item-sub">读取状态和音源列表</span>
        </span>
      </button>

      <button type="button" className="diagnostic-item" onClick={() => void window.obsGuard.refreshInputs()}>
        <span className="diagnostic-item-icon"><RefreshCw size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">刷新音源列表</span>
          <span className="diagnostic-item-sub">从 OBS 重新读取</span>
        </span>
      </button>

      <button type="button" className="diagnostic-item" onClick={() => void window.obsGuard.testAlert()}>
        <span className="diagnostic-item-icon"><AlertTriangle size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">测试报警弹窗</span>
          <span className="diagnostic-item-sub">查看弹窗与声音效果</span>
        </span>
      </button>

      {snapshot.preAlertVisible && (
        <button type="button" className="diagnostic-item" onClick={() => void window.obsGuard.dismissPreAlert()}>
          <span className="diagnostic-item-icon"><BellOff size={16} /></span>
          <span className="diagnostic-item-body">
            <span className="diagnostic-item-title">关闭当前预报警</span>
            <span className="diagnostic-item-sub">本次静音段不再预警</span>
          </span>
        </button>
      )}

      <button type="button" className="diagnostic-item" onClick={onOpenManual}>
        <span className="diagnostic-item-icon"><BookOpen size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">查看说明书</span>
          <span className="diagnostic-item-sub">完整功能与操作说明</span>
        </span>
      </button>

      <button type="button" className="diagnostic-item danger" onClick={onReset}>
        <span className="diagnostic-item-icon"><Trash2 size={16} /></span>
        <span className="diagnostic-item-body">
          <span className="diagnostic-item-title">恢复出厂设置</span>
          <span className="diagnostic-item-sub">清空设置和历史</span>
        </span>
      </button>
    </div>

    {testingConnection && <div className="diagnostic-result pending">正在测试 OBS WebSocket 连接…</div>}
    {!testingConnection && testResult && <div className={`diagnostic-result ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.message}</div>}
  </Section>
);

// ====== 7. 报警历史(列表) ======
export const HistorySection: React.FC<{
  snapshot: AppSnapshot;
  onClear: () => void;
}> = ({ snapshot, onClear }) => (
  <Section id="settings-history" icon={History} title="报警历史" description="本地保存最近 20 条报警记录">
    {snapshot.history.length === 0 ? (
      <div className="empty-block">暂无报警记录</div>
    ) : (
      <>
        <div className="history-list">
          {snapshot.history.map((entry) => (
            <div className="history-item" key={entry.id}>
              <div>
                <strong>{entry.inputName}</strong>
                <div className="history-time">{new Date(entry.timestamp).toLocaleString()}</div>
              </div>
              <div className="history-item-side">
                <strong>{entry.silentForSeconds}s</strong>
                <div>{entry.action === 'acknowledge' ? '已确认' : '单次忽略'}</div>
              </div>
            </div>
          ))}
        </div>
        <div>
          <button type="button" className="btn-ghost btn-danger-text" onClick={onClear}>
            <Trash2 size={14} />
            清空历史
          </button>
        </div>
      </>
    )}
  </Section>
);

// ====== 8. 软件更新 ======
const updateIcon = (state: UpdateSnapshot) => {
  switch (state.status) {
    case 'available': case 'downloading': return <Download size={16} />;
    case 'downloaded': return <Info size={16} />;
    case 'error': return <AlertTriangle size={16} />;
    default: return <RefreshCw size={16} />;
  }
};
const updateTone = (state: UpdateSnapshot) => {
  switch (state.status) {
    case 'available': return 'warning';
    case 'downloaded': return 'success';
    case 'error': return 'error';
    default: return 'info';
  }
};
const updateTitle = (state: UpdateSnapshot) => {
  switch (state.status) {
    case 'available': return state.availableVersion ? `发现 v${state.availableVersion}` : '发现新版本';
    case 'downloading': return '正在下载更新';
    case 'downloaded': return state.downloadedVersion
      ? `v${state.downloadedVersion} 已下载`
      : '更新已下载';
    case 'error': return '更新源暂时不可用';
    case 'not_available': return '当前为最新版本';
    case 'checking': return '正在检查更新';
    default: return '检查 GitHub 更新';
  }
};

export const UpdatesSection: React.FC<{
  draft: AppConfig;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  updateState: UpdateSnapshot | null;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}> = ({ draft, onChange, updateState, onCheck, onDownload, onInstall }) => {
  if (!updateState) {
    return <Section id="settings-updates" icon={Download} title="软件更新" description="正在加载…"><div className="empty-block">正在加载更新信息</div></Section>;
  }
  const busy = updateState.status === 'checking' || updateState.status === 'downloading';
  const canCheck = updateState.status !== 'unsupported' && !busy;
  const canDownload = updateState.status === 'available';
  const canInstall = updateState.status === 'downloaded';
  const tone = updateTone(updateState);
  return (
    <Section id="settings-updates" icon={Download} title="软件更新" description="检查新版本、选择国内加速源">
      <div className="update-panel">
        <div className="update-panel-head">
          <span className={`update-panel-icon tone-${tone}`}>{updateIcon(updateState)}</span>
          <div className="update-panel-copy">
            <div className="update-panel-title">{updateTitle(updateState)}</div>
            <div className="update-panel-msg">{updateState.message}</div>
          </div>
        </div>
        <div className="about-list">
          <div className="about-row"><span>当前版本</span><strong>v{updateState.currentVersion}</strong></div>
          <div className="about-row"><span>当前更新源</span><strong>{updateState.sourceLabel}</strong></div>
          {updateState.sourceUrl && <div className="about-row"><span>源地址</span><strong>{updateState.sourceUrl}</strong></div>}
          {updateState.attemptedSources.length > 0 && <div className="about-row"><span>已尝试</span><strong>{updateState.attemptedSources.join('、')}</strong></div>}
          {updateState.lastCheckedAt && <div className="about-row"><span>上次检查</span><strong>{new Date(updateState.lastCheckedAt).toLocaleString()}</strong></div>}
        </div>
        {(updateState.status === 'downloading' || updateState.status === 'downloaded') && (
          <div className="update-progress"><span style={{ width: `${updateState.percent ?? 0}%` }} /></div>
        )}
        <div className="update-actions">
          <button type="button" className="btn-secondary" onClick={onCheck} disabled={!canCheck}>
            <RefreshCw size={14} />
            {updateState.status === 'checking' ? '检查中…' : '检查更新'}
          </button>
          {canDownload && (
            <button type="button" className="btn-primary" onClick={onDownload}>
              <Download size={14} /> 下载更新
            </button>
          )}
          {canInstall && (
            <button type="button" className="btn-primary" onClick={onInstall}>
              <Power size={14} /> {updateState.installMode === 'manual' ? '打开安装包' : '重启安装'}
            </button>
          )}
        </div>
        {updateState.status === 'unsupported' && (
          <div className="settings-hint warn">开发模式不会检查更新。安装包版本会自动启用。</div>
        )}
      </div>

      <div className="settings-field">
        <span className="settings-field-label">更新源策略</span>
        <div className="update-source-grid">
          {[
            { value: 'auto', title: '自动选择', desc: draft.aliyunUpdateBaseUrl ? '阿里云优先，失败后切换加速源和 GitHub' : '加速源优先，失败后切换 GitHub', icon: <Route size={16} /> },
            { value: 'github', title: 'GitHub', desc: '官方 Release 源，海外网络最稳', icon: <Globe2 size={16} /> },
            { value: 'gh_proxy', title: 'gh-proxy.com', desc: '公共 GitHub 加速代理', icon: <Download size={16} /> },
            { value: 'ghproxy_net', title: 'ghproxy.net', desc: '备用公共加速代理', icon: <Download size={16} /> },
            { value: 'aliyun', title: '阿里云镜像', desc: '使用你的 OSS/CDN 镜像地址', icon: <Cloud size={16} /> }
          ].map((item) => (
            <button
              type="button"
              key={item.value}
              className={`update-source-option ${draft.updateSource === item.value ? 'active' : ''}`}
              onClick={() => onChange('updateSource', item.value as AppConfig['updateSource'])}
            >
              <span className="update-source-option-icon">{item.icon}</span>
              <span>
                <strong>{item.title}</strong>
                <em>{item.desc}</em>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="aliyun-update-url">阿里云 OSS/CDN 镜像地址</label>
        <input
          id="aliyun-update-url"
          className="input"
          value={draft.aliyunUpdateBaseUrl}
          onChange={(event) => onChange('aliyunUpdateBaseUrl', event.target.value)}
          placeholder="例如 https://your-bucket.oss-cn-hangzhou.aliyuncs.com/obs-audio-monitor-assistant/latest/"
        />
        <p className="settings-section-hint">
          这个地址应直接包含 latest.yml、latest-mac.yml、安装包和 blockmap 文件。当前阿里云公开 mirrors 并不通用同步本仓库 Release，建议用你自己的 OSS 或 CDN。
        </p>
      </div>
    </Section>
  );
};

// ====== 9. 关于 ======
export const AboutSection: React.FC<{
  appVersion: string;
  targetName: string;
}> = ({ appVersion, targetName }) => (
  <Section id="settings-about" icon={Info} title="关于" description="OBS 音频检测助手">
    <div className="about-list">
      <div className="about-row"><span>产品名称</span><strong>OBS 音频检测助手</strong></div>
      <div className="about-row"><span>当前版本</span><strong>v{appVersion}</strong></div>
      <div className="about-row"><span>当前音源</span><strong>{targetName}</strong></div>
      <div className="about-row"><span>更新方式</span><strong>GitHub / 镜像源自动更新</strong></div>
    </div>
    <p className="settings-section-hint">
      OBS 音频检测助手是一款直播现场音频异常提醒工具。仅连接本地 OBS WebSocket,数据不离开本机。
    </p>
  </Section>
);
