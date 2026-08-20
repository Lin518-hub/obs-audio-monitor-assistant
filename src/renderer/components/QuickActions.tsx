import React from 'react';
import { Monitor, Pause, Play, RefreshCw } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';

interface QuickActionsProps {
  snapshot: AppSnapshot;
  onTogglePause: () => void;
  onToggleFloating: () => void;
  onReconnect: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ snapshot, onTogglePause, onToggleFloating, onReconnect }) => {
  const monitoringActive = snapshot.monitoringActive;
  const floatingOn = snapshot.config.floatingWindowEnabled;
  return (
    <div className="quick-grid">
      <button type="button" className={`quick-card ${monitoringActive ? 'warning' : 'active'}`} onClick={onTogglePause}>
        <span className="quick-card-icon">{monitoringActive ? <Pause size={18} /> : <Play size={18} />}</span>
        <span className="quick-card-body">
          <span className="quick-card-title">{monitoringActive ? '停止检测' : '开始检测'}</span>
          <span className="quick-card-sub">{monitoringActive ? '当前正在检测' : '当前已停止'}</span>
        </span>
      </button>
      <button type="button" className={`quick-card ${floatingOn ? 'active' : ''}`} onClick={onToggleFloating}>
        <span className="quick-card-icon"><Monitor size={18} /></span>
        <span className="quick-card-body">
          <span className="quick-card-title">{floatingOn ? '关闭小浮窗' : '打开小浮窗'}</span>
          <span className="quick-card-sub">{floatingOn ? '常驻桌面' : '置顶状态条'}</span>
        </span>
      </button>
      <button type="button" className="quick-card" onClick={onReconnect}>
        <span className="quick-card-icon"><RefreshCw size={18} /></span>
        <span className="quick-card-body">
          <span className="quick-card-title">重连 OBS</span>
          <span className="quick-card-sub">连接异常时使用</span>
        </span>
      </button>
    </div>
  );
};
