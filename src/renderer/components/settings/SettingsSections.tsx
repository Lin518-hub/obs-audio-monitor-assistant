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
  QrCode,
  RefreshCw,
  Route,
  TestTube2,
  Timer,
  Trash2,
  Video,
  Volume2,
  Wifi
} from 'lucide-react';
import QRCode from 'qrcode';
import { defaultATEMInputColor } from '../../../shared/atemPalette';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
  type AlertSoundPreset,
  type AppConfig,
  type AppSnapshot,
  type ATEMScanResult,
  type ATEMTestResult,
  type FloatingWindowMode,
  type TestConnectionResult,
  type UpdateSnapshot
} from '../../../shared/types';
import { snapshotTargetName } from '../../utils/status';
import { playAlertTone } from '../../utils/alertSound';
import { NumberField, SegmentedControl, ToggleRow } from './widgets';
import { SourcePicker } from './SourcePicker';
import { MorandiColorPicker, StyledSelect } from '../StyledSelect';

interface SectionProps {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}

const AlertStylePreview: React.FC<{ mode: 'classic' | 'fullscreen' }> = ({ mode }) => (
  <div className={`alert-style-preview alert-style-preview-${mode}`} aria-hidden="true">
    {mode === 'fullscreen' && (
      <div className="alert-preview-desktop">
        <span /><span /><span />
        <i /><i />
      </div>
    )}
    {mode === 'fullscreen' && <div className="alert-preview-vignette" />}
    <div className="alert-preview-window">
      <div className="alert-preview-heading">
        <span className="alert-preview-icon"><AlertTriangle size={12} /></span>
        <span className="alert-preview-heading-copy">
          <b>音频静音提醒</b>
          <strong>麦克风/Aux 可能没有声音</strong>
        </span>
      </div>
      <span className="alert-preview-line" />
      <div className="alert-preview-actions">
        <span>单次忽略</span>
        <span>确定</span>
      </div>
    </div>
  </div>
);

const AlertStylePicker: React.FC<{
  value: 'classic' | 'fullscreen';
  onChange: (value: 'classic' | 'fullscreen') => void;
}> = ({ value, onChange }) => {
  const options = [
    {
      value: 'classic' as const,
      title: '经典弹窗',
      description: '只显示正式报警弹窗,适合需要最少干扰的工作台。'
    },
    {
      value: 'fullscreen' as const,
      title: '全屏红边 + 弹窗',
      description: '屏幕四周显示红色渐变边框,中间保留正式报警弹窗。'
    }
  ];

  return (
    <div className="alert-style-picker" role="radiogroup" aria-label="正式报警样式">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`alert-style-option ${selected ? 'active' : ''}`}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
          >
            <div className="alert-style-option-preview">
              <AlertStylePreview mode={option.value} />
              {selected && <span className="alert-style-selected">当前使用</span>}
            </div>
            <div className="alert-style-option-copy">
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

const FloatingModePreview: React.FC<{ mode: FloatingWindowMode }> = ({ mode }) => (
  <div className={`floating-mode-preview floating-mode-preview-${mode}`} aria-hidden="true">
    <div className="floating-preview-topbar">
      <span className="floating-preview-dot" />
      <strong>{mode === 'audio' ? '检测中' : mode === 'audio_atem' ? '音频与机位' : '多功能监看'}</strong>
      <span className="floating-preview-actions"><i /><i /><i /></span>
    </div>
    {mode === 'audio' ? (
      <>
        <div className="floating-preview-audio-status">正在讲话</div>
        <div className="floating-preview-audio-meta">麦克风 / Aux</div>
        <div className="floating-preview-meter"><span /></div>
      </>
    ) : mode === 'audio_atem' ? (
      <div className="floating-preview-combo">
        <div className="floating-preview-combo-metrics">
          <span><b>音频检测</b><strong>正在讲话</strong><em>麦克风 / Aux</em></span>
          <span><b>当前机位</b><strong>04:05</strong><em>PGM 1 · Camera 1</em></span>
        </div>
        <i className="floating-preview-combo-meter" />
        <div className="floating-preview-combo-prompts"><span>音频正常</span><span>剩余 00:55</span></div>
      </div>
    ) : (
      <div className="floating-preview-module-grid">
        <div className="floating-preview-module floating-preview-module-wide"><b>音频守护</b><strong>音频正常</strong><span /></div>
        <div className="floating-preview-module"><b>ATEM</b><strong>PGM 1</strong></div>
        <div className="floating-preview-module"><b>OBS</b><strong>60 FPS</strong></div>
      </div>
    )}
  </div>
);

const FloatingModePicker: React.FC<{
  value: FloatingWindowMode;
  onChange: (value: FloatingWindowMode) => void;
}> = ({ value, onChange }) => {
  const options = [
    {
      value: 'audio' as const,
      title: '音频提醒',
      description: '只显示讲话状态、静音倒计时和实时电平,保持最小占用。'
    },
    {
      value: 'audio_atem' as const,
      title: '音频 + 机位',
      description: '在同一个状态面板中显示音频、当前机位和机位计时。'
    },
    {
      value: 'multifunction' as const,
      title: '多功能监看',
      description: '按模块显示音频、ATEM 和 OBS 性能摘要,内容会自适应排版。'
    }
  ];

  return (
    <div className="floating-mode-picker" role="radiogroup" aria-label="小浮窗模式">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`floating-mode-option ${selected ? 'active' : ''}`}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
          >
            <div className="floating-mode-option-preview">
              <FloatingModePreview mode={option.value} />
              {selected && <span className="alert-style-selected">当前使用</span>}
            </div>
            <div className="floating-mode-option-copy">
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

const ALERT_SOUND_OPTIONS: Array<{ value: AlertSoundPreset; title: string; description: string }> = [
  { value: 'strong', title: '沉稳提醒', description: '音量更饱满,适合导播环境' },
  { value: 'clear', title: '清晰提醒', description: '明亮易辨,适合主播桌面' },
  { value: 'low', title: '低频提醒', description: '更厚实,不刺耳' },
  { value: 'soft', title: '柔和提醒', description: '较短较柔和,适合安静环境' }
];

const AlertSoundPicker: React.FC<{
  value: AlertSoundPreset;
  onChange: (value: AlertSoundPreset) => void;
}> = ({ value, onChange }) => {
  const [previewing, setPreviewing] = React.useState<AlertSoundPreset | null>(null);

  const preview = (preset: AlertSoundPreset) => {
    setPreviewing(preset);
    playAlertTone(true, preset);
    window.setTimeout(() => setPreviewing((current) => current === preset ? null : current), 720);
  };

  return (
    <div className="alert-sound-picker" role="radiogroup" aria-label="提示音类型">
      {ALERT_SOUND_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <div
            key={option.value}
            className={`alert-sound-option ${selected ? 'active' : ''}`}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onChange(option.value);
              }
            }}
          >
            <span className="alert-sound-icon"><Volume2 size={15} /></span>
            <span className="alert-sound-copy">
              <strong>{option.title}</strong>
              <em>{option.description}</em>
            </span>
            <button
              type="button"
              className="alert-sound-preview-button"
              onClick={(event) => { event.stopPropagation(); preview(option.value); }}
              aria-label={`试听${option.title}`}
            >
              <Play size={11} />
              {previewing === option.value ? '播放中' : '试听'}
            </button>
          </div>
        );
      })}
    </div>
  );
};

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
    <ToggleRow
      id="remember-obs-password"
      title="安全保存 OBS 密码"
      description={draft.rememberObsPassword
        ? '使用系统凭据库加密保存。macOS 可能请求登录钥匙串授权，这是系统在保护 OBS 密码。'
        : '密码仅在本次运行期间使用，退出软件后不会保存，也不会访问系统钥匙串。'}
      checked={draft.rememberObsPassword}
      onChange={(value) => onChange('rememberObsPassword', value)}
    />
    <div className="credential-actions">
      <span>OBS 未设置 WebSocket 密码时可关闭保存并清空输入。</span>
      <button type="button" className="btn-secondary compact" onClick={() => onChange('obsPassword', '')}>清空密码</button>
    </div>
    <div className={`settings-hint ${snapshot.connected ? '' : 'warn'}`}>
      {snapshot.connected
        ? snapshot.simulatedLive ? '当前为模拟开播检测' : '已能读取 OBS 状态和可检测音频源'
        : '请确认 OBS 已打开,且 WebSocket 已启用'}
    </div>
  </Section>
);

// ====== ATEM 导播台 ======
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
    setScanResult(null);
    try {
      const result = await window.obsGuard.testATEMConnection(draft.atemHost);
      setTestResult(result);
      if (result.ok && draft.atemEnabled) {
        await window.obsGuard.atemReconnect();
      }
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : 'ATEM 连接测试失败',
        inputCount: 0
      });
    } finally {
      setTesting(false);
    }
  }, [draft.atemEnabled, draft.atemHost]);

  const handleScanNetwork = React.useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    setTestResult(null);
    try {
      const result = await window.obsGuard.scanATEMNetwork(draft.atemHost);
      setScanResult(result);
    } catch (error) {
      setScanResult({
        ok: false,
        message: error instanceof Error ? error.message : 'ATEM 局域网扫描失败',
        scannedHosts: 0,
        interfaces: [],
        devices: []
      });
    } finally {
      setScanning(false);
    }
  }, [draft.atemHost]);

  const connectionStatusLabel = () => {
    if (snapshot.atemConnectionState === 'connecting') return { text: '正在连接…', tone: '' };
    if (snapshot.atemConnectionState === 'error') return { text: '连接失败', tone: 'warn' };
    if (snapshot.atemConnected) return { text: '已连接', tone: '' };
    return { text: '未连接', tone: 'warn' };
  };

  const status = connectionStatusLabel();

  React.useEffect(() => {
    if (snapshot.atemConnected) {
      setScanResult((current) => current && !current.ok ? null : current);
    }
  }, [snapshot.atemConnected]);

  return (
    <Section id="settings-atem" icon={Video} title="ATEM 导播台" description="通过网络连接 Blackmagic ATEM 切换台">
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
              {!snapshot.atemConnected && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleTestConnection()}
                  disabled={testing || !draft.atemHost}
                >
                  <RefreshCw size={14} className={testing ? 'spin' : ''} />
                  {testing ? '连接中…' : '连接导播台'}
                </button>
              )}
            </div>
          </div>

          {!snapshot.atemConnected && (
            <details className="settings-action-drawer">
              <summary><Route size={14} />不知道 IP？查找局域网导播台</summary>
              <div>
                <p>只在自动连接失败或不知道导播台地址时使用，扫描可能需要一些时间。</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleScanNetwork()}
                  disabled={scanning}
                >
                  <Route size={14} className={scanning ? 'spin' : ''} />
                  {scanning ? '正在查找…' : '开始查找'}
                </button>
              </div>
            </details>
          )}

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
                <> · PGM {snapshot.atemProgramInput}{snapshot.atemInputLabels[snapshot.atemProgramInput] ? ` (${snapshot.atemInputLabels[snapshot.atemProgramInput]})` : ''} · {snapshot.atemInputCount} 路常用信号</>
              )}
              {!snapshot.atemConnected && snapshot.atemConnectionState !== 'connecting' && (
                <>
                  {snapshot.atemReconnectAttempt > 0
                    ? ` — 第 ${snapshot.atemReconnectAttempt} 次退避重连已安排`
                    : ' — 请确认 IP 地址正确且 ATEM 与电脑在同一网络'}
                </>
              )}
            </span>
          </div>

          {snapshot.atemConnected && snapshot.atemInputCount > 0 && (
            <details className="settings-action-drawer settings-content-drawer">
              <summary>机位名称、颜色与分组</summary>
              <div className="atem-customization-list">
                {snapshot.atemInputIds.map((num) => {
                  const key = String(num);
                  const hardwareLabel = snapshot.atemInputHardwareLabels[num] || `Input ${num}`;
                  const custom = draft.atemInputCustomizations[key] || { name: '', color: defaultATEMInputColor(num), group: '' };
                  const isProgram = num === snapshot.atemProgramInput;
                  const isPreview = num === snapshot.atemPreviewInput;
                  const updateCustomization = (patch: Partial<typeof custom>) => onChange('atemInputCustomizations', {
                    ...draft.atemInputCustomizations,
                    [key]: { ...custom, ...patch }
                  });
                  return (
                    <div
                      key={num}
                      className={`atem-customization-row ${isProgram ? 'program' : isPreview ? 'preview' : ''}`}
                    >
                      <div className="atem-customization-source"><i style={{ background: custom.color }} /><strong>{num}</strong><span>{hardwareLabel}</span></div>
                      <input className="input" value={custom.name} onChange={(event) => updateCustomization({ name: event.target.value })} placeholder="自定义名称" aria-label={`${hardwareLabel} 自定义名称`} />
                      <input className="input" value={custom.group} onChange={(event) => updateCustomization({ group: event.target.value })} placeholder="分组，如 主播" aria-label={`${hardwareLabel} 分组`} />
                      <MorandiColorPicker value={custom.color} onChange={(color) => updateCustomization({ color })} ariaLabel={`${hardwareLabel} 颜色`} />
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </Section>
  );
};

export const ATEMRulesSection: React.FC<{
  draft: AppConfig;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, onChange }) => (
  <Section id="settings-atem-rules" icon={Video} title="机位检测规则" description="单机位停留报警与切台保护">
    <ToggleRow
      id="atem-camera-timer"
      title="启用单机位超时报警"
      description="直播、录制或模拟开播后从零计时；同一 PGM 机位停留超时后使用与音频相同的报警样式、提示音和多屏策略"
      checked={draft.atemCameraTimeAlertEnabled}
      onChange={(value) => onChange('atemCameraTimeAlertEnabled', value)}
    />
    {draft.atemCameraTimeAlertEnabled && (
      <div className="settings-progressive-block">
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="atem-camera-limit">单机位报警时长</label>
          <NumberField
            value={draft.atemCameraTimeLimitSeconds}
            min={10}
            max={3600}
            step={10}
            suffix="秒"
            onChange={(value) => onChange('atemCameraTimeLimitSeconds', value)}
          />
        </div>
        <ToggleRow
          id="atem-floating-module"
          title="在小浮窗显示当前机位"
          description="启用音频 + 机位模式，一体显示 PGM 机位和已使用时间"
          checked={draft.floatingWindowMode === 'audio_atem' || (draft.floatingWindowMode === 'multifunction' && draft.floatingWindowModules.atem)}
          onChange={(value) => {
            onChange('floatingWindowModules', { ...draft.floatingWindowModules, atem: value });
            if (value) {
              onChange('floatingWindowMode', 'audio_atem');
              onChange('floatingWindowEnabled', true);
            } else if (draft.floatingWindowMode === 'audio_atem') {
              onChange('floatingWindowMode', 'audio');
            }
          }}
        />
      </div>
    )}
    <div className="settings-subgroup atem-control-settings">
      <div className="settings-subgroup-title">切台保护</div>
      <ToggleRow
        id="atem-hardcut-confirm"
        title="危险切台二次确认"
        description="AUTO、Hard Cut 与全局 Enter 切换前均需明确确认"
        checked={draft.atemHardCutConfirm}
        onChange={(value) => onChange('atemHardCutConfirm', value)}
      />
      <ToggleRow
        id="atem-hotkey-global"
        title="全局切台快捷键"
        description="Num1–8 选择 PVW，Enter 执行 AUTO；只建议固定导播工作站开启"
        tone="danger"
        checked={draft.atemHotkeyGlobal}
        onChange={(value) => onChange('atemHotkeyGlobal', value)}
      />
    </div>
  </Section>
);

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
  <Section id="settings-rules" icon={Timer} title="音频静音规则" description="每个音源独立计时，任一路超时都会报警">
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
      当前选择的每个音源都会单独判断，不取平均值。口播密集可缩短静音时长，访谈或活动直播可适当延长；阈值也可在主界面电平表上拖动调整。
    </p>
  </Section>
);

export const AlertExperienceSection: React.FC<{
  draft: AppConfig;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, onChange }) => (
  <Section id="settings-alerts" icon={AlertTriangle} title="提醒方式" description="正式报警、预警浮窗和声音">
    <div className="settings-field">
      <span className="settings-field-label">正式报警样式</span>
      <AlertStylePicker
        value={draft.alertReminderMode === 'classic' ? 'classic' : 'fullscreen'}
        onChange={(v) => onChange('alertReminderMode', v)}
      />
    </div>
    <ToggleRow
      id="rule-alert-sound"
      title="声音提示"
      description="正式报警后持续循环提示音,关闭报警后停止"
      checked={draft.alertSoundEnabled}
      onChange={(v) => onChange('alertSoundEnabled', v)}
    />
    <div className="settings-subgroup settings-prealert-group">
      <div className="settings-subgroup-title">报警前预警</div>
      <ToggleRow
        id="rule-prealert"
        title="启用预警浮窗"
        description="达到正式报警时长前先显示黄色小浮窗提示"
        checked={draft.preAlertEnabled}
        onChange={(v) => onChange('preAlertEnabled', v)}
      />
      {draft.preAlertEnabled && (
        <div className="settings-progressive-block">
          <div className="settings-field settings-prealert-ratio">
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
          <p className="settings-section-hint">例如正式报警为 120 秒，75% 会在静音 90 秒时出现预警浮窗。</p>
        </div>
      )}
    </div>
    {draft.alertSoundEnabled && (
      <div className="settings-subgroup settings-sound-group">
        <div className="settings-subgroup-title">提示音类型</div>
        <AlertSoundPicker
          value={draft.alertSoundPreset}
          onChange={(v) => onChange('alertSoundPreset', v)}
        />
        <p className="settings-section-hint">正式报警后循环播放，确认或单次忽略后立即停止；声音通过系统默认扬声器输出。</p>
      </div>
    )}
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
          <span className="settings-field-label">弹出屏幕</span>
          <StyledSelect
            value={draft.alertDisplayId === null ? '' : String(draft.alertDisplayId)}
            ariaLabel="弹出屏幕"
            onChange={(value) => onChange('alertDisplayId', value ? Number(value) : null)}
            options={[
              { value: '', label: '选择屏幕' },
              ...snapshot.displays.map((display) => ({
                value: String(display.id),
                label: display.label,
                description: `${display.bounds.width} × ${display.bounds.height}`
              }))
            ]}
          />
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

// ====== 5. 小浮窗 ======
export const FloatingWindowSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => (
  <Section id="settings-window" icon={Monitor} title="小浮窗" description="置顶状态条、显示模式与监看模块">
    <ToggleRow
      id="system-floating"
      title="小浮窗置顶显示"
      description={draft.floatingWindowEnabled ? '当前已显示并保持在其他窗口上方' : '打开后会自动置顶,适合直播中持续观察'}
      checked={draft.floatingWindowEnabled}
      onChange={(v) => onChange('floatingWindowEnabled', v)}
    />
    {draft.floatingWindowEnabled && (
      <div className="settings-progressive-block">
        <div className="settings-field">
          <span className="settings-field-label">小浮窗模式</span>
          <FloatingModePicker
            value={draft.floatingWindowMode}
            onChange={(v) => onChange('floatingWindowMode', v)}
          />
        </div>
        {draft.floatingWindowMode === 'multifunction' ? (
          <div className="settings-subgroup">
            <div className="settings-subgroup-title">多功能模块</div>
            <ToggleRow
              id="floating-module-audio"
              title="音频守护"
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
              description="显示 FPS、CPU 和推流码率"
              checked={draft.floatingWindowModules.obsStats}
              onChange={(v) => onChange('floatingWindowModules', { ...draft.floatingWindowModules, obsStats: v })}
            />
          </div>
        ) : draft.floatingWindowMode === 'audio_atem' ? (
          <div className="settings-hint">音频、PGM 机位和已使用时间会在同一个固定比例面板中显示。</div>
        ) : (
          <div className="settings-hint">仅显示音频状态和实时电平，保持最小占用。</div>
        )}
      </div>
    )}
    <p className="settings-section-hint">
      当前检测到 {snapshot.displays.length} 个屏幕，小浮窗与设置主窗口相互独立。
    </p>
  </Section>
);

export const BackgroundSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => (
  <Section id="settings-system" icon={Power} title="后台运行" description="开机启动与关闭主窗口后的行为">
    <ToggleRow
      id="system-autolaunch"
      title="开机自动启动"
      description="开机后打开助手并直接进入开播检查"
      checked={draft.autoLaunch}
      onChange={(value) => onChange('autoLaunch', value)}
    />
    <div className="settings-hint">
      关闭主窗口只会隐藏界面，检测仍会在托盘或菜单栏中继续运行；需要彻底退出时请使用托盘菜单。
    </div>
    <p className="settings-section-hint">当前检测到 {snapshot.displays.length} 个屏幕，配置更改会实时保存。</p>
  </Section>
);

export const RemoteAccessSection: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}> = ({ draft, snapshot, onChange }) => {
  const [qrDataUrl, setQrDataUrl] = React.useState('');
  const [copyLabel, setCopyLabel] = React.useState('复制扫码链接');
  const normalizedServerUrl = draft.remoteServerUrl.trim().replace(/\/$/, '');
  const usingBuiltInService = normalizedServerUrl === LAN_REMOTE_SERVER_URL || normalizedServerUrl === PUBLIC_REMOTE_SERVER_URL;
  const activeRoute = snapshot.remoteAccessActiveServerUrl === LAN_REMOTE_SERVER_URL
    ? '局域网线路'
    : snapshot.remoteAccessActiveServerUrl === PUBLIC_REMOTE_SERVER_URL
      ? '公网 HTTPS'
      : snapshot.remoteAccessActiveServerUrl
        ? '自定义线路'
        : '';
  const pairFallbackBase = usingBuiltInService ? PUBLIC_REMOTE_SERVER_URL : normalizedServerUrl;

  React.useEffect(() => {
    let active = true;
    if (!snapshot.remoteAccessPairUrl) {
      setQrDataUrl('');
      return () => { active = false; };
    }
    void QRCode.toDataURL(snapshot.remoteAccessPairUrl, {
      width: 320, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0F172A', light: '#FFFFFF' }
    }).then((url) => { if (active) setQrDataUrl(url); });
    return () => { active = false; };
  }, [snapshot.remoteAccessPairUrl]);

  const status = snapshot.remoteAccessConnected
    ? { label: `远程服务已连接${activeRoute ? ` · ${activeRoute}` : ''}`, tone: 'ok' }
    : snapshot.remoteAccessConnectionState === 'connecting'
      ? { label: usingBuiltInService ? '正在自动检测局域网与公网线路' : '正在连接自定义远程服务', tone: 'pending' }
      : snapshot.remoteAccessErrorMessage
        ? { label: snapshot.remoteAccessErrorMessage, tone: 'bad' }
        : { label: '远程访问未启用', tone: 'idle' };

  const copyPairUrl = async () => {
    if (!snapshot.remoteAccessPairUrl) return;
    await navigator.clipboard.writeText(snapshot.remoteAccessPairUrl);
    setCopyLabel('已复制');
    window.setTimeout(() => setCopyLabel('复制扫码链接'), 1500);
  };

  return (
    <Section id="settings-remote" icon={QrCode} title="手机远程访问" description="扫码申请、移动监看和访问审批">
      <ToggleRow
        id="remote-access-enabled"
        title="启用手机扫码访问"
        description="电脑主动连接远程服务；手机必须经过管理员审批后才能查看监控状态"
        checked={draft.remoteAccessEnabled}
        onChange={(value) => onChange('remoteAccessEnabled', value)}
      />
      <div className={`remote-route-card ${usingBuiltInService ? 'auto' : 'custom'}`}>
        <Route size={18} />
        <div>
          <strong>{usingBuiltInService ? '自动选择连接线路' : '使用自定义远程服务'}</strong>
          <span>{usingBuiltInService ? '局域网与公网错峰连接，局域网可用时优先使用，否则自动转到公网 HTTPS。' : normalizedServerUrl}</span>
        </div>
        {usingBuiltInService && <b>自动</b>}
      </div>
      <details className="remote-custom-server" open={!usingBuiltInService}>
        <summary>自定义服务器地址</summary>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="remote-server-url">服务器 URL</label>
          <input id="remote-server-url" className="input" value={draft.remoteServerUrl} onChange={(event) => onChange('remoteServerUrl', event.target.value)} placeholder="https://example.com:8088" />
          {!usingBuiltInService && <button type="button" className="btn-secondary" onClick={() => onChange('remoteServerUrl', PUBLIC_REMOTE_SERVER_URL)}>恢复自动连接</button>}
        </div>
      </details>
      <div className={`diagnostic-result ${status.tone}`}><Wifi size={15} /> {status.label}</div>
      <div className="remote-metrics-grid">
        <div><span>线路类型</span><strong>{snapshot.remoteAccessRouteType === 'lan' ? '局域网' : snapshot.remoteAccessRouteType === 'public' ? '公网 HTTPS' : snapshot.remoteAccessRouteType === 'custom' ? '自定义' : '--'}</strong></div>
        <div><span>服务延迟</span><strong>{snapshot.remoteAccessLatencyMs === null ? '--' : `${snapshot.remoteAccessLatencyMs} ms`}</strong></div>
        <div><span>在线手机</span><strong>{snapshot.remoteAccessOnlineMobileClients} 台</strong></div>
        <div><span>最后同步</span><strong>{snapshot.remoteAccessLastSyncAt ? new Date(snapshot.remoteAccessLastSyncAt).toLocaleTimeString() : '--'}</strong></div>
      </div>
      <div className="remote-device-id"><span>本机 UUID</span><code>{draft.remoteDeviceUuid}</code></div>
      <div className="remote-access-grid">
        <div className="remote-qr-card">
          {qrDataUrl ? <img src={qrDataUrl} alt="手机远程访问二维码" /> : <div className="remote-qr-placeholder"><QrCode size={42} /><span>连接服务后生成二维码</span></div>}
        </div>
        <div className="remote-access-copy">
          <strong>首次扫码需要审批</strong>
          <p>手机输入直播间名称并提交申请，管理员在统一后台批准后，该浏览器才会进入监控面板。</p>
          <button type="button" className="btn-secondary" disabled={!snapshot.remoteAccessPairUrl} onClick={() => void copyPairUrl()}>{copyLabel}</button>
          <code>{snapshot.remoteAccessPairUrl || `${pairFallbackBase}/pair/等待连接`}</code>
        </div>
      </div>
      <div className="settings-hint warn">手机端仅提供只读监看，不允许远程切换 ATEM。公网使用时只批准可信设备，并及时撤销不再使用的授权。</div>
    </Section>
  );
};

// ====== 6. 诊断测试 ======
export const DiagnosticsSection: React.FC<{
  mode?: 'all' | 'tests' | 'support';
  snapshot: AppSnapshot;
  testingConnection: boolean;
  testResult: TestConnectionResult | null;
  onTestConnection: () => void;
  onOpenManual: () => void;
  onReset: () => void;
}> = ({ mode = 'all', snapshot, testingConnection, testResult, onTestConnection, onOpenManual, onReset }) => (
  <Section id="settings-diagnostics" icon={TestTube2} title={mode === 'support' ? '帮助与恢复' : '诊断测试'} description={mode === 'support' ? '说明书和危险维护操作' : '本地调试与连接验证'}>
    <div className="diagnostics-grid">
      {mode !== 'support' && (
        <>
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
        </>
      )}

      {mode !== 'tests' && (
        <>
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
              <span className="diagnostic-item-sub">清空设置和历史，操作前会再次确认</span>
            </span>
          </button>
        </>
      )}
    </div>

    {mode !== 'support' && testingConnection && <div className="diagnostic-result pending">正在测试 OBS WebSocket 连接…</div>}
    {mode !== 'support' && !testingConnection && testResult && <div className={`diagnostic-result ${testResult.ok ? 'ok' : 'bad'}`}>{testResult.message}</div>}
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
    default: return '检查软件更新';
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
    <Section id="settings-updates" icon={Download} title="软件更新" description="内部服务器优先，自动保持最新">
      <div className="update-panel">
        <div className="update-panel-head">
          <span className={`update-panel-icon tone-${tone}`}>{updateIcon(updateState)}</span>
          <div className="update-panel-copy">
            <div className="update-panel-title">{updateTitle(updateState)}</div>
            <div className="update-panel-msg">{updateState.message}</div>
          </div>
        </div>
        <ToggleRow
          id="auto-update-enabled"
          checked={draft.autoUpdateEnabled}
          onChange={(checked) => onChange('autoUpdateEnabled', checked)}
          title="自动保持软件最新"
          description={updateState.installMode === 'manual'
            ? '后台优先从内部服务器预下载；macOS 下次启动时会打开已下载的安装包'
            : '后台优先从内部服务器预下载，下次启动时静默安装并自动重启'}
        />
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

      <details className="settings-action-drawer settings-content-drawer">
        <summary><Route size={14} />高级更新线路</summary>
        <div className="settings-advanced-update">
          <div className="settings-field">
            <span className="settings-field-label">更新源策略</span>
            <div className="update-source-grid">
              {[
                { value: 'auto', title: '自动选择', desc: '内部服务器优先，不可用时再切换镜像和 GitHub', icon: <Route size={16} /> },
                { value: 'lan', title: '内部服务器', desc: '使用手机远程服务中的更新目录', icon: <Wifi size={16} /> },
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
            <p className="settings-section-hint">地址中应直接包含更新描述文件、安装包和 blockmap；没有自建镜像时保持自动选择即可。</p>
          </div>
        </div>
      </details>
    </Section>
  );
};

// ====== 9. 关于 ======
export const AboutSection: React.FC<{
  appVersion: string;
  targetName: string;
  onVersionClick?: () => void;
}> = ({ appVersion, targetName, onVersionClick }) => (
  <Section id="settings-about" icon={Info} title="关于" description="OBS 音频检测助手">
    <div className="about-list">
      <div className="about-row"><span>产品名称</span><strong>OBS 音频检测助手</strong></div>
      <button type="button" className="about-row about-version-trigger" onClick={onVersionClick}>
        <span>当前版本</span><strong>v{appVersion}</strong>
      </button>
      <div className="about-row"><span>当前音源</span><strong>{targetName}</strong></div>
      <div className="about-row"><span>更新方式</span><strong>GitHub / 镜像源自动更新</strong></div>
    </div>
    <p className="settings-section-hint">
      OBS 音频检测助手是一款直播现场音频异常提醒工具。仅连接本地 OBS WebSocket,数据不离开本机。
    </p>
  </Section>
);
