import React from 'react';
import { Bell, Search } from 'lucide-react';

export type SaveLabel = { text: string; state: 'idle' | 'saving' | 'saved' | 'error' };

interface TopBarProps {
  searchPlaceholder: string;
  onSearchChange: (q: string) => void;
  saveLabel: SaveLabel;
  onNotifications: () => void;
  hasUpdateNotice?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({ searchPlaceholder, onSearchChange, saveLabel, onNotifications, hasUpdateNotice = false }) => {
  return (
    <header className="topbar">
      <div className="topbar-search">
        <span className="topbar-search-icon">
          <Search size={16} />
        </span>
        <input
          type="text"
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="topbar-actions">
        <span className="save-chip" data-state={saveLabel.state}>
          <span className="save-chip-dot" />
          {saveLabel.text}
        </span>
        <button type="button" className="topbar-icon-btn" onClick={onNotifications} aria-label="软件更新">
          <Bell size={18} />
          {hasUpdateNotice && <span className="notif-dot" />}
        </button>
      </div>
    </header>
  );
};
