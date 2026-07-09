import React from 'react';
import { Activity, Bell, Calendar, History, Mic2, Settings as SettingsIcon, LayoutDashboard } from 'lucide-react';
import { APP_VERSION } from '../utils/appVersion';
import { displayStatusText } from '../utils/status';
import type { AppSnapshot } from '../../shared/types';

export type SidebarPage = 'dashboard' | 'history';

interface SidebarProps {
  snapshot: AppSnapshot;
  active: SidebarPage;
  onChange: (next: SidebarPage) => void;
  onOpenSettings: () => void;
  historyCount: number;
}

const items: { id: SidebarPage; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'history', label: '报警历史', icon: History }
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
        {items.map((item) => {
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
              {item.id === 'history' && historyCount > 0 && <span className="badge">{historyCount}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="sidebar-nav-item"
          onClick={onOpenSettings}
        >
          <span className="icon"><SettingsIcon size={18} /></span>
          <span>设置</span>
        </button>
      </nav>

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
