import React from 'react';
import { History, Trash2 } from 'lucide-react';
import type { AppSnapshot } from '../../shared/types';

interface HistoryListProps {
  snapshot: AppSnapshot;
  onClear: () => void;
  search?: string;
}

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

export const HistoryList: React.FC<HistoryListProps> = ({ snapshot, onClear, search = '' }) => {
  const query = search.trim().toLowerCase();
  const entries = query
    ? snapshot.history.filter((entry) => `${entry.inputName} ${formatTime(entry.timestamp)} ${entry.silentForSeconds}`.toLowerCase().includes(query))
    : snapshot.history;
  return (
    <section className="settings-section history-page-card" id="history-page">
      <div className="settings-section-title">
        <span className="settings-section-title-icon"><History size={18} /></span>
        <div>
          <strong>报警历史</strong>
          <em>本地保存最近 20 条报警记录</em>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-block">{snapshot.history.length === 0 ? '暂无报警记录' : '没有匹配的报警记录'}</div>
      ) : (
        <>
          <div className="history-list" style={{ maxHeight: 'none' }}>
            {entries.map((entry) => (
              <div className="history-item" key={entry.id}>
                <div>
                  <strong>{entry.inputName}</strong>
                  <div className="history-time">{formatTime(entry.timestamp)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{entry.silentForSeconds}s</strong>
                  <div>{entry.action === 'acknowledge' ? '已确认' : '单次忽略'}</div>
                </div>
              </div>
            ))}
          </div>
          <div>
            <button type="button" className="btn-ghost" onClick={onClear} style={{ color: 'var(--red-text)' }}>
              <Trash2 size={14} />
              清空历史
            </button>
          </div>
        </>
      )}
    </section>
  );
};
