import React, { useCallback, useEffect, useState } from 'react';
import {
  Cable,
  Download,
  History,
  Info,
  Mic2,
  Monitor,
  Smartphone,
  SlidersHorizontal,
  TestTube2,
  Video,
  X
} from 'lucide-react';
import type { AppConfig, AppSnapshot, TestConnectionResult, UpdateSnapshot } from '../../shared/types';
import { snapshotTargetName } from '../utils/status';
import {
  AboutSection, ATEMSection, AudioSourceSection, ConnectionSection, DiagnosticsSection,
  DisplaySection, HistorySection, RemoteAccessSection, RulesSection, SystemSection, UpdatesSection
} from './settings/SettingsSections';

type SectionId = 'connection' | 'atem' | 'remote' | 'monitor' | 'window' | 'diagnostics' | 'updates' | 'history' | 'about';

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
  group: '连接' | '检测提醒' | '维护';
  visible: (s: AppSnapshot) => boolean;
}

const tabs: TabItem[] = [
  { id: 'connection', label: 'OBS 连接', description: 'WebSocket', icon: Cable, group: '连接', visible: () => true },
  { id: 'atem', label: 'ATEM Beta', description: '导播台 / 机位', icon: Video, group: '连接', visible: () => true },
  { id: 'remote', label: '手机远程', description: '扫码 / 审批', icon: Smartphone, group: '连接', visible: () => true },
  { id: 'monitor', label: '检测与报警', description: '音源 / 时长 / 阈值', icon: Mic2, group: '检测提醒', visible: () => true },
  { id: 'window', label: '窗口与后台', description: '浮窗 / 多屏 / 自启', icon: Monitor, group: '检测提醒', visible: () => true },
  { id: 'diagnostics', label: '诊断测试', description: '测试 / 维护', icon: TestTube2, group: '维护', visible: () => true },
  { id: 'updates', label: '软件更新', description: 'GitHub / 镜像', icon: Download, group: '维护', visible: () => true },
  { id: 'history', label: '报警历史', description: '最近记录', icon: History, group: '维护', visible: () => true },
  { id: 'about', label: '关于软件', description: '版本信息', icon: Info, group: '维护', visible: () => true }
];

const sectionForFocus = (focus?: string | null): SectionId => {
  switch (focus) {
    case 'source':
    case 'rules':
    case 'monitor':
      return 'monitor';
    case 'display':
    case 'system':
    case 'window':
      return 'window';
    case 'diagnostics':
    case 'atem':
    case 'remote':
    case 'updates':
    case 'history':
    case 'about':
    case 'connection':
      return focus;
    default:
      return 'connection';
  }
};

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
    setActive(sectionForFocus(focusSection));
  }, [open, focusSection]);

  if (!open && !closing) return null;

  const visibleTabs = tabs.filter((t) => t.visible(snapshot));
  const activeTab = visibleTabs.find((t) => t.id === active) ?? visibleTabs[0];
  const groupedTabs = visibleTabs.reduce<Record<TabItem['group'], TabItem[]>>((acc, tab) => {
    acc[tab.group].push(tab);
    return acc;
  }, { '连接': [], '检测提醒': [], '维护': [] });

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
            {Object.entries(groupedTabs).map(([group, items]) => items.length > 0 && (
              <div className="settings-nav-group" key={group}>
                <div className="settings-nav-group-title">{group}</div>
                {items.map((t) => {
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
              </div>
            ))}
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
            {active === 'atem' && <ATEMSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />}
            {active === 'remote' && <RemoteAccessSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />}
            {active === 'monitor' && (
              <>
                <AudioSourceSection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
                <RulesSection draft={draft} onChange={onChangeDraft} />
              </>
            )}
            {active === 'window' && (
              <>
                <SystemSection draft={draft} onChange={onChangeDraft} snapshot={snapshot} />
                <DisplaySection draft={draft} snapshot={snapshot} onChange={onChangeDraft} />
              </>
            )}
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
