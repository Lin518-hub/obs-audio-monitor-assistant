import React from 'react';
import { Activity, Bell, History, LayoutDashboard, ListChecks, Mic2, Settings as SettingsIcon, Video } from 'lucide-react';
import { APP_VERSION } from '../utils/appVersion';
import { displayStatusText } from '../utils/status';
import type { AppSnapshot } from '../../shared/types';

export type SidebarPage = 'dashboard' | 'preflight' | 'monitor' | 'atem' | 'history';

interface SidebarProps {
  snapshot: AppSnapshot;
  active: SidebarPage;
  onChange: (next: SidebarPage) => void;
  onOpenSettings: () => void;
  historyCount: number;
}

const groups: Array<{
  title: string;
  items: { id: SidebarPage; label: string; icon: React.ComponentType<{ size?: number }>; badge?: string; developerOnly?: boolean }[];
}> = [
  {
    title: '直播监看',
    items: [
      { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
      { id: 'preflight', label: '开播检查', icon: ListChecks, badge: 'BETA', developerOnly: true },
      { id: 'monitor', label: '监控面板', icon: Activity, badge: 'BETA' }
    ]
  },
  {
    title: '设备与记录',
    items: [
      { id: 'atem', label: 'ATEM 导播台', icon: Video, badge: 'BETA' },
      { id: 'history', label: '报警历史', icon: History }
    ]
  }
];

export const Sidebar: React.FC<SidebarProps> = ({ snapshot, active, onChange, onOpenSettings, historyCount }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-logo">
          <Mic2 size={22} />
        </div>
        <div className="sidebar-brand-name">音频助手</div>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {groups.map((group) => (
          <div className="sidebar-nav-group" key={group.title}>
            <div className="sidebar-nav-group-title">{group.title}</div>
            {group.items.filter((item) => !item.developerOnly || snapshot.config.developerModeEnabled).map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => onChange(item.id)}
                >
                  <span className="icon"><Icon size={18} /></span>
                  <span>{item.label}</span>
                  {item.badge && <span className="badge beta">{item.badge}</span>}
                  {item.id === 'history' && historyCount > 0 && <span className="badge">{historyCount}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-settings-card">
        <button type="button" className="sidebar-nav-item sidebar-settings-pill" onClick={onOpenSettings}>
          <span className="icon"><SettingsIcon size={18} /></span>
          <span>设置</span>
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-avatar" aria-hidden="true">
          <Bell size={16} />
        </div>
        <div className="sidebar-footer-info">
          <div className="sidebar-footer-name">OBS 音频检测助手</div>
          <div className="sidebar-footer-status">
            v{APP_VERSION} · {displayStatusText(snapshot)}
          </div>
        </div>
      </div>
    </aside>
  );
};
