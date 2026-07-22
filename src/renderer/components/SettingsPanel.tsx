import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BellRing,
  BookOpen,
  Cable,
  ChevronDown,
  Download,
  History,
  Info,
  Mic2,
  Monitor,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  TestTube2,
  Video,
  Wrench,
  X
} from 'lucide-react';
import type { AppConfig, AppSnapshot, TestConnectionResult, UpdateSnapshot } from '../../shared/types';
import { snapshotTargetName } from '../utils/status';
import {
  AboutSection,
  AlertExperienceSection,
  ATEMRulesSection,
  ATEMSection,
  AudioSourceSection,
  BackgroundSection,
  ConnectionSection,
  DiagnosticsSection,
  DisplaySection,
  FloatingWindowSection,
  HistorySection,
  RemoteAccessSection,
  RulesSection,
  UpdatesSection
} from './settings/SettingsSections';

type SectionId = 'devices' | 'rules' | 'alerts' | 'system' | 'maintenance';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  snapshot: AppSnapshot;
  draft: AppConfig;
  onChangeDraft: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  updateState: UpdateSnapshot | null;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  testingConnection: boolean;
  testResult: TestConnectionResult | null;
  onTestConnection: () => void;
  onOpenManual: () => void;
  onReset: () => void;
  appVersion: string;
  focusSection?: string | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

interface TabItem {
  id: SectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
}

const tabs: TabItem[] = [
  { id: 'devices', label: '连接与设备', description: 'OBS、音源与ATEM', icon: Cable },
  { id: 'rules', label: '检测规则', description: '静音、机位与多音源', icon: ShieldCheck },
  { id: 'alerts', label: '提醒与窗口', description: '报警、声音、浮窗与多屏', icon: BellRing },
  { id: 'system', label: '系统与更新', description: '后台、更新与本地数据', icon: Settings2 },
  { id: 'maintenance', label: '维护工具', description: '测试、说明与恢复', icon: Wrench }
];

const sectionForFocus = (focus?: string | null): SectionId => {
  switch (focus) {
    case 'connection':
    case 'source':
    case 'atem':
    case 'remote':
      return 'devices';
    case 'rules':
    case 'monitor':
      return 'rules';
    case 'display':
    case 'window':
      return 'alerts';
    case 'system':
    case 'updates':
    case 'history':
    case 'about':
      return 'system';
    case 'diagnostics':
      return 'maintenance';
    default:
      return 'devices';
  }
};

interface DisclosureProps {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description: string;
  summary: string;
  defaultOpen?: boolean;
  tone?: 'default' | 'warning' | 'success';
  children: React.ReactNode;
}

const SettingsDisclosure: React.FC<DisclosureProps> = ({
  icon: Icon,
  title,
  description,
  summary,
  defaultOpen = false,
  tone = 'default',
  children
}) => {
  const [expanded, setExpanded] = useState(defaultOpen);
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (defaultOpen) setExpanded(true);
  }, [defaultOpen]);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const updateHeight = () => {
      const nextHeight = Math.ceil(inner.getBoundingClientRect().height);
      setContentHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <section className={`settings-disclosure ${expanded ? 'expanded' : ''} tone-${tone}`}>
      <button
        type="button"
        className="settings-disclosure-trigger"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="settings-disclosure-icon"><Icon size={18} /></span>
        <span className="settings-disclosure-copy">
          <strong>{title}</strong>
          <em>{description}</em>
        </span>
        <span className="settings-disclosure-summary">{summary}</span>
        <ChevronDown size={17} className="settings-disclosure-chevron" />
      </button>
      <div
        className="settings-disclosure-region"
        aria-hidden={!expanded}
        inert={!expanded}
        style={{ height: expanded ? `${contentHeight}px` : '0px' }}
      >
        <div className="settings-disclosure-inner" ref={innerRef}>{children}</div>
      </div>
    </section>
  );
};

const selectedSourceSummary = (draft: AppConfig) => {
  const names = draft.targetInputNames?.length > 0
    ? draft.targetInputNames
    : draft.targetInputName
      ? [draft.targetInputName]
      : [];
  if (names.length === 0) return '尚未选择音源';
  if (names.length === 1) return names[0];
  return `${names.length} 个音源独立守护`;
};

const DEVELOPER_PASSWORD_SHA256 = '36135da9586652aa0bdefee628001c4c4eb6901e278a44233a23cd2811eadc19';
const DEVELOPER_CLICK_GAP_MS = 1600;

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const SettingsPanel: React.FC<SettingsPanelProps> = (props) => {
  const {
    open,
    onClose,
    snapshot,
    draft,
    onChangeDraft,
    updateState,
    onCheckUpdate,
    onDownloadUpdate,
    onInstallUpdate,
    testingConnection,
    testResult,
    onTestConnection,
    onOpenManual,
    onReset,
    appVersion,
    focusSection,
    saveState
  } = props;
  const [active, setActive] = useState<SectionId>('devices');
  const [closing, setClosing] = useState(false);
  const [developerDialogOpen, setDeveloperDialogOpen] = useState(false);
  const [developerPassword, setDeveloperPassword] = useState('');
  const [developerPasswordError, setDeveloperPasswordError] = useState('');
  const [developerUnlocking, setDeveloperUnlocking] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const developerClicksRef = useRef({ count: 0, lastAt: 0 });

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => { setClosing(false); onClose(); }, 200);
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (developerDialogOpen) {
        setDeveloperDialogOpen(false);
        setDeveloperPassword('');
        setDeveloperPasswordError('');
        return;
      }
      handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, developerDialogOpen, handleClose]);

  useEffect(() => {
    if (!open) return;
    setActive(sectionForFocus(focusSection));
  }, [open, focusSection]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [active]);

  const handleAboutVersionClick = useCallback(() => {
    if (draft.developerModeEnabled) return;
    const now = performance.now();
    const previous = developerClicksRef.current;
    const count = now - previous.lastAt <= DEVELOPER_CLICK_GAP_MS ? previous.count + 1 : 1;
    developerClicksRef.current = { count, lastAt: now };
    if (count < 10) return;
    developerClicksRef.current = { count: 0, lastAt: 0 };
    setDeveloperPassword('');
    setDeveloperPasswordError('');
    setDeveloperDialogOpen(true);
  }, [draft.developerModeEnabled]);

  const handleDeveloperUnlock = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (developerUnlocking) return;
    setDeveloperUnlocking(true);
    try {
      if (await sha256(developerPassword) !== DEVELOPER_PASSWORD_SHA256) {
        setDeveloperPasswordError('密码不正确，请重新输入。');
        return;
      }
      onChangeDraft('developerModeEnabled', true);
      setDeveloperDialogOpen(false);
      setDeveloperPassword('');
      setDeveloperPasswordError('');
    } finally {
      setDeveloperUnlocking(false);
    }
  }, [developerPassword, developerUnlocking, onChangeDraft]);

  const closeDeveloperDialog = useCallback(() => {
    setDeveloperDialogOpen(false);
    setDeveloperPassword('');
    setDeveloperPasswordError('');
  }, []);

  if (!open && !closing) return null;

  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const updateSummary = !updateState
    ? `当前 v${appVersion}`
    : updateState.status === 'available'
      ? `可更新至 v${updateState.availableVersion ?? ''}`
      : updateState.status === 'downloaded'
        ? '更新已下载'
        : `当前 v${updateState.currentVersion}`;
  const alertSummary = `${draft.silenceDurationSeconds} 秒 · ${draft.silenceThresholdDb} dB · ${draft.alertSoundEnabled ? '声音开启' : '静音提醒'}`;
  const atemTimerSummary = draft.atemCameraTimeAlertEnabled
    ? `${Math.round(draft.atemCameraTimeLimitSeconds / 60)} 分钟报警`
    : '机位报警已关闭';

  return (
    <div className={`settings-overlay ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label="设置" onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <aside className="settings-side">
          <div className="settings-side-brand">
            <span className="settings-side-logo"><SlidersHorizontal size={18} /></span>
            <div>
              <strong>功能配置</strong>
              <em>更改实时保存</em>
            </div>
          </div>
          <nav className="settings-side-nav" aria-label="设置分类">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-nav-item ${active === tab.id ? 'active' : ''}`}
                  onClick={() => setActive(tab.id)}
                >
                  <span className="settings-nav-icon"><Icon size={17} /></span>
                  <span className="settings-nav-copy">
                    <strong>{tab.label}</strong>
                    <em>{tab.description}</em>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className={`settings-autosave-note state-${saveState}`} role="status">
            <i />
            {saveState === 'saving' ? '正在自动保存' : saveState === 'error' ? '保存失败，请重试' : '所有更改已自动保存'}
          </div>
        </aside>

        <section className="settings-content">
          <button type="button" className="close-btn settings-close" onClick={handleClose} aria-label="关闭"><X size={18} /></button>
          <div className="settings-content-title">
            <strong>{activeTab.label}</strong>
            <span>{activeTab.description}</span>
          </div>
          <div className="settings-body" ref={bodyRef}>
            <div className="settings-page-sheet">
            {active === 'devices' && (
              <>
                <SettingsDisclosure
                  icon={Cable}
                  title="OBS 连接"
                  description="WebSocket 与连接状态"
                  summary={snapshot.connected ? `已连接 · ${draft.obsHost}:${draft.obsPort}` : '未连接 · 展开检查'}
                  defaultOpen={!snapshot.connected || focusSection === 'connection'}
                  tone={snapshot.connected ? 'success' : 'warning'}
                >
                  <ConnectionSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Mic2}
                  title="守护音源"
                  description="选择需要独立检测的声音输入"
                  summary={selectedSourceSummary(draft)}
                  defaultOpen={(!draft.targetInputName && draft.targetInputNames.length === 0) || focusSection === 'source'}
                  tone={(draft.targetInputName || draft.targetInputNames.length > 0) ? 'success' : 'warning'}
                >
                  <AudioSourceSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Video}
                  title="ATEM 导播台"
                  description="网络连接、信号源与机位名称"
                  summary={draft.atemEnabled ? (snapshot.atemConnected ? `已连接 · ${draft.atemHost}` : '已启用 · 等待连接') : '未启用'}
                  defaultOpen={focusSection === 'atem'}
                  tone={snapshot.atemConnected ? 'success' : draft.atemEnabled ? 'warning' : 'default'}
                >
                  <ATEMSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                </SettingsDisclosure>
                {draft.developerModeEnabled && (
                  <SettingsDisclosure
                    icon={Smartphone}
                    title="手机远程"
                    description="扫码申请、线路与访问状态"
                    summary={draft.remoteAccessEnabled ? (snapshot.remoteAccessConnected ? `${snapshot.remoteAccessRouteType === 'lan' ? '局域网' : '公网'} · ${snapshot.remoteAccessOnlineMobileClients} 台在线` : '已启用 · 等待服务') : '未启用'}
                    defaultOpen={focusSection === 'remote'}
                    tone={snapshot.remoteAccessConnected ? 'success' : draft.remoteAccessEnabled ? 'warning' : 'default'}
                  >
                    <RemoteAccessSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                  </SettingsDisclosure>
                )}
              </>
            )}

            {active === 'rules' && (
              <>
                <SettingsDisclosure
                  icon={Mic2}
                  title="音频静音检测"
                  description="多音源独立计时与静音判定"
                  summary={alertSummary}
                  defaultOpen={focusSection === 'rules' || focusSection === 'monitor' || !focusSection}
                >
                  <RulesSection draft={draft} onChange={onChangeDraft} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Video}
                  title="机位停留检测"
                  description="ATEM 单机位计时与安全切台"
                  summary={atemTimerSummary}
                >
                  <ATEMRulesSection draft={draft} onChange={onChangeDraft} />
                </SettingsDisclosure>
              </>
            )}

            {active === 'alerts' && (
              <>
                <SettingsDisclosure
                  icon={BellRing}
                  title="正式报警与预警"
                  description="报警外观、提示音和预警时机"
                  summary={`${draft.alertReminderMode === 'fullscreen' ? '全屏红边' : '经典弹窗'} · ${draft.preAlertEnabled ? `${Math.round(draft.preAlertRatio * 100)}% 预警` : '无预警'}`}
                  defaultOpen={!focusSection}
                >
                  <AlertExperienceSection draft={draft} onChange={onChangeDraft} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Monitor}
                  title="小浮窗"
                  description="置顶状态条与显示模块"
                  summary={draft.floatingWindowEnabled ? `已开启 · ${draft.floatingWindowMode === 'audio' ? '音频' : draft.floatingWindowMode === 'audio_atem' ? '音频 + 机位' : '多功能'}` : '未开启'}
                  defaultOpen={focusSection === 'window'}
                >
                  <FloatingWindowSection draft={draft} onChange={onChangeDraft} snapshot={snapshot} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Monitor}
                  title="报警屏幕与位置"
                  description="多屏显示和弹窗位置记忆"
                  summary={snapshot.displays.length <= 1 ? '单屏自动居中' : `${snapshot.displays.length} 个屏幕 · ${draft.alertDisplayMode === 'all' ? '全部显示' : '指定显示'}`}
                  defaultOpen={focusSection === 'display'}
                >
                  <DisplaySection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                </SettingsDisclosure>
              </>
            )}

            {active === 'system' && (
              <>
                <SettingsDisclosure
                  icon={Settings2}
                  title="后台运行"
                  description="开机启动与关闭窗口行为"
                  summary={draft.autoLaunch ? '开机自动启动' : '手动启动'}
                  defaultOpen={focusSection === 'system' || !focusSection}
                >
                  <BackgroundSection draft={draft} onChange={onChangeDraft} snapshot={snapshot} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Download}
                  title="软件更新"
                  description="版本状态与更新线路"
                  summary={updateSummary}
                  tone={updateState?.status === 'available' || updateState?.status === 'downloaded' ? 'warning' : 'default'}
                >
                  <UpdatesSection draft={draft} onChange={onChangeDraft} updateState={updateState} onCheck={onCheckUpdate} onDownload={onDownloadUpdate} onInstall={onInstallUpdate} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={History}
                  title="本地记录"
                  description="报警历史与数据清理"
                  summary={`${snapshot.history.length} 条报警记录`}
                >
                  <HistorySection snapshot={snapshot} onClear={() => void window.obsGuard.clearHistory()} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={Info}
                  title="关于软件"
                  description="版本与当前守护对象"
                  summary={`v${appVersion}`}
                >
                  <AboutSection appVersion={appVersion} targetName={snapshotTargetName(snapshot)} onVersionClick={handleAboutVersionClick} />
                </SettingsDisclosure>
              </>
            )}

            {active === 'maintenance' && (
              <>
                {draft.developerModeEnabled && (
                  <div className="developer-mode-status" role="status">
                    <span className="developer-mode-status-icon"><ShieldCheck size={18} /></span>
                    <span className="developer-mode-status-copy">
                      <strong>开发者模式已启用</strong>
                      <em>手机远程功能已显示，原有远程配置保持不变。</em>
                    </span>
                    <button type="button" className="btn-secondary" onClick={() => onChangeDraft('developerModeEnabled', false)}>关闭开发者模式</button>
                  </div>
                )}
                <SettingsDisclosure
                  icon={TestTube2}
                  title="检测与调试"
                  description="仅在排查或开播前验证时使用"
                  summary={snapshot.simulatedLive ? '模拟开播已开启' : '默认收起'}
                  defaultOpen={focusSection === 'diagnostics'}
                >
                  <DiagnosticsSection mode="tests" snapshot={snapshot} testingConnection={testingConnection} testResult={testResult} onTestConnection={onTestConnection} onOpenManual={onOpenManual} onReset={onReset} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  icon={BookOpen}
                  title="帮助与恢复"
                  description="说明书与危险维护操作"
                  summary="默认收起"
                >
                  <DiagnosticsSection mode="support" snapshot={snapshot} testingConnection={testingConnection} testResult={testResult} onTestConnection={onTestConnection} onOpenManual={onOpenManual} onReset={onReset} />
                </SettingsDisclosure>
              </>
            )}
            </div>
          </div>
        </section>
      </div>
      {developerDialogOpen && (
        <div className="developer-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) closeDeveloperDialog(); }}>
          <form className="developer-dialog" onSubmit={(event) => void handleDeveloperUnlock(event)}>
            <button type="button" className="close-btn developer-dialog-close" onClick={closeDeveloperDialog} aria-label="关闭"><X size={17} /></button>
            <span className="developer-dialog-icon"><ShieldCheck size={22} /></span>
            <div className="developer-dialog-heading">
              <strong>启用开发者模式</strong>
              <span>输入开发者密码后，将显示手机远程功能。</span>
            </div>
            <label className="developer-dialog-field">
              <span>开发者密码</span>
              <input
                autoFocus
                className={`input ${developerPasswordError ? 'input-error' : ''}`}
                type="password"
                autoComplete="off"
                value={developerPassword}
                onChange={(event) => {
                  setDeveloperPassword(event.target.value);
                  if (developerPasswordError) setDeveloperPasswordError('');
                }}
                placeholder="请输入密码"
              />
            </label>
            {developerPasswordError && <div className="developer-dialog-error" role="alert">{developerPasswordError}</div>}
            <div className="developer-dialog-actions">
              <button type="button" className="btn-secondary" onClick={closeDeveloperDialog}>取消</button>
              <button type="submit" className="btn-primary" disabled={!developerPassword || developerUnlocking}>{developerUnlocking ? '验证中…' : '启用'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
