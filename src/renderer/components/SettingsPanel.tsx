import React, { useCallback, useEffect, useState } from 'react';
import {
  Cable,
  Download,
  History,
  Info,
  Mic2,
  Monitor,
  Power,
  SlidersHorizontal,
  TestTube2,
  Timer,
  X
} from 'lucide-react';
import type { AppConfig, AppSnapshot, TestConnectionResult, UpdateSnapshot } from '../../shared/types';
import { snapshotTargetName } from '../utils/status';
import {
  AboutSection, AudioSourceSection, ConnectionSection, DiagnosticsSection,
  DisplaySection, HistorySection, RulesSection, SystemSection, UpdatesSection
} from './settings/SettingsSections';

type SectionId = 'connection' | 'source' | 'rules' | 'display' | 'system' | 'diagnostics' | 'history' | 'updates' | 'about';

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
}

interface TabItem {
  id: SectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  visible: (s: AppSnapshot) => boolean;
}

const tabs: TabItem[] = [
  { id: 'connection', label: 'OBS 连接', description: 'WebSocket', icon: Cable, visible: () => true },
  { id: 'source', label: '目标音源', description: '麦克风 / 声卡', icon: Mic2, visible: () => true },
  { id: 'rules', label: '报警规则', description: '时长 / 阈值', icon: Timer, visible: () => true },
  { id: 'display', label: '报警显示', description: '多屏位置', icon: Monitor, visible: (s) => s.displays.length > 1 },
  { id: 'system', label: '后台守护', description: '开机自启', icon: Power, visible: () => true },
  { id: 'diagnostics', label: '诊断测试', description: '测试 / 维护', icon: TestTube2, visible: () => true },
  { id: 'history', label: '报警历史', description: '最近记录', icon: History, visible: () => true },
  { id: 'updates', label: '软件更新', description: 'GitHub / 镜像', icon: Download, visible: () => true },
  { id: 'about', label: '关于软件', description: '版本信息', icon: Info, visible: () => true }
];

export const SettingsPanel: React.FC<SettingsPanelProps> = (props) => {
  const { open, onClose, snapshot, draft, onChangeDraft, updateState, onCheckUpdate, onDownloadUpdate, onInstallUpdate, testingConnection, testResult, onTestConnection, onOpenManual, onReset, appVersion, focusSection } = props;
  const [active, setActive] = useState<SectionId>('connection');
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => { setClosing(false); onClose(); }, 200);
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  useEffect(() => {
    if (!open) return;
    const target = focusSection && tabs.some((t) => t.id === focusSection) ? (focusSection as SectionId) : 'connection';
    setActive(target);
  }, [open, focusSection]);

  if (!open && !closing) return null;

  const visibleTabs = tabs.filter((t) => t.visible(snapshot));
  const activeTab = visibleTabs.find((t) => t.id === active) ?? visibleTabs[0];

  return (
    <div className={`settings-overlay ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-side">
          <div className="settings-side-brand">
            <span className="settings-side-logo"><SlidersHorizontal size={18} /></span>
            <div>
              <strong>功能配置</strong>
              <em>实时保存</em>
            </div>
          </div>
          <nav className="settings-side-nav" aria-label="设置分类">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`settings-nav-item ${active === t.id ? 'active' : ''}`}
                  onClick={() => setActive(t.id)}
                >
                  <span className="settings-nav-icon"><Icon size={17} /></span>
                  <span className="settings-nav-copy">
                    <strong>{t.label}</strong>
                    <em>{t.description}</em>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="settings-content">
          <button type="button" className="close-btn settings-close" onClick={handleClose} aria-label="关闭"><X size={18} /></button>
          <div className="settings-content-title">
            <strong>{activeTab?.label}</strong>
            <span>{activeTab?.description}</span>
          </div>
          <div className="settings-body">
            {active === 'connection' && <ConnectionSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />}
            {active === 'source' && <AudioSourceSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />}
            {active === 'rules' && <RulesSection draft={draft} onChange={onChangeDraft} />}
            {active === 'display' && <DisplaySection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />}
            {active === 'system' && <SystemSection draft={draft} onChange={onChangeDraft} />}
            {active === 'diagnostics' && (<DiagnosticsSection snapshot={snapshot} testingConnection={testingConnection} testResult={testResult} onTestConnection={onTestConnection} onOpenManual={onOpenManual} onReset={onReset} />)}
            {active === 'history' && <HistorySection snapshot={snapshot} onClear={() => void window.obsGuard.clearHistory()} />}
            {active === 'updates' && <UpdatesSection draft={draft} onChange={onChangeDraft} updateState={updateState} onCheck={onCheckUpdate} onDownload={onDownloadUpdate} onInstall={onInstallUpdate} />}
            {active === 'about' && <AboutSection appVersion={appVersion} targetName={snapshotTargetName(snapshot)} />}
          </div>
        </section>
      </div>
    </div>
  );
};
