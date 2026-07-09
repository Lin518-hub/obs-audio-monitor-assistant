import React from 'react';
import type { AppSnapshot } from '../../../shared/types';
import { liveStatusLabel, recordingStatusLabel, snapshotTargetName } from '../../utils/status';

interface ConnectionStatusCardProps {
  snapshot: AppSnapshot;
}

const Row: React.FC<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'muted' }> = ({ label, value, tone = 'muted' }) => (
  <div className="connection-row">
    <span className="connection-row-label">{label}</span>
    <span className={`connection-row-value ${tone}`}>{value}</span>
  </div>
);

export const ConnectionStatusCard: React.FC<ConnectionStatusCardProps> = ({ snapshot }) => {
  const connected = snapshot.connected;
  const target = snapshotTargetName(snapshot);
  const live = snapshot.streaming;
  const rec = snapshot.recording;
  return (
    <section className="right-card" data-guide="connection-status">
      <div className="right-card-title">
        <strong>连接状态</strong>
        <span className={`connection-pill ${connected ? '' : 'offline'}`}>{connected ? '已连接' : '未连接'}</span>
      </div>
      <div className="connection-list">
        <Row label="目标音源" value={target} tone={snapshot.config.targetInputName ? 'ok' : 'warn'} />
        <Row label="直播" value={liveStatusLabel(snapshot)} tone={live ? 'ok' : 'muted'} />
        <Row label="录制" value={recordingStatusLabel(snapshot)} tone={rec ? 'ok' : 'muted'} />
        <Row label="OBS WebSocket" value={connected ? '正常' : '断开'} tone={connected ? 'ok' : 'danger'} />
      </div>
    </section>
  );
};
