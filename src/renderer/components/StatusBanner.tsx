import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Mic2, ShieldCheck } from 'lucide-react';
import { AUDIO_ALERT_SECONDS, reminderVisualState } from '../../shared/reminderTiming';
import type { AppSnapshot } from '../../shared/types';
import { displayedSilenceSeconds, readinessActionText, readinessText, safetyTitle, snapshotLiveStateLabel, snapshotTone, snapshotTargetName } from '../utils/status';

interface StatusBannerProps {
  snapshot: AppSnapshot;
}

const iconFor = (tone: ReturnType<typeof snapshotTone>) => {
  if (tone === 'safe') return <CheckCircle2 size={26} />;
  if (tone === 'warning') return <Clock3 size={26} />;
  if (tone === 'danger') return <AlertTriangle size={26} />;
  return <ShieldCheck size={26} />;
};

export const StatusBanner: React.FC<StatusBannerProps> = ({ snapshot }) => {
  const tone = snapshotTone(snapshot);
  const visual = reminderVisualState(displayedSilenceSeconds(snapshot), AUDIO_ALERT_SECONDS);
  const reminderStyle = {
    '--audio-warning-progress': String(visual.warningProgress),
    '--audio-danger-progress': String(visual.dangerProgress)
  } as React.CSSProperties;
  return (
    <section className={`status-banner tone-${tone}`} data-guide="overview" style={reminderStyle}>
      <div className="status-banner-icon">{iconFor(tone)}</div>
      <div className="status-banner-body">
        <div className="status-banner-title">
          {safetyTitle(snapshot)}
          <span className="status-banner-pill">{snapshotLiveStateLabel(snapshot)}</span>
        </div>
        <p className="status-banner-text">{readinessText(snapshot)}</p>
        <p className="status-banner-action">{readinessActionText(snapshot)}</p>
      </div>
      <div className="status-banner-meta">
        <div className="status-banner-meta-label">当前音源</div>
        <div className="status-banner-meta-value">
          <Mic2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {snapshotTargetName(snapshot)}
        </div>
      </div>
    </section>
  );
};
