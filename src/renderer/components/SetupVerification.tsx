import React, { useEffect, useState } from 'react';
import type { AppConfig, AppSnapshot } from '../../shared/types';
export function SetupVerification({ draft, snapshot, verifiedSource, onVerified, confirmed, onConfirmed }: {
  draft: AppConfig; snapshot: AppSnapshot; verifiedSource: string; onVerified: (source: string) => void; confirmed: boolean; onConfirmed: () => void;
}) {
  const [startedAt, setStartedAt] = useState(0);
  const [heardSource, setHeardSource] = useState('');
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setStartedAt(0); setHeardSource(''); }, [draft.targetInputName]);
  useEffect(() => {
    if (startedAt && snapshot.connected && snapshot.activeInputName === draft.targetInputName
      && (snapshot.lastAudioMeterReceivedAt ?? 0) > startedAt && (snapshot.lastLevelDb ?? -100) > draft.silenceThresholdDb) setHeardSource(draft.targetInputName);
  }, [snapshot, draft.targetInputName, draft.silenceThresholdDb, startedAt]);
  const test = async () => {
    setBusy(true); setError(''); setTested(false);
    try { await window.obsGuard.testAlert(); setTested(true); }
    catch { setError('测试报警未能打开，请重试。'); }
    finally { setBusy(false); }
  };
  const audioConfirmed = Boolean(verifiedSource && verifiedSource === draft.targetInputName);
  const heard = Boolean(heardSource && heardSource === draft.targetInputName);
  const ready = snapshot.connected && Boolean(draft.targetInputName);
  const level = ready && snapshot.activeInputName === draft.targetInputName && Date.now() - (snapshot.lastAudioMeterReceivedAt ?? 0) < 2000 ? snapshot.lastLevelDb : null;
  return <div className="onboarding-card-body setup-verification">
    <div className="onboarding-step-title"><h2>确认音频与提醒</h2></div>
    <p className="onboarding-step-desc">完成两项检查，确保检测的是正确声音，并且能看到报警。</p>
    <section className="verification-panel">
      <header><span className="verification-number">1</span><h3>检查麦克风声音</h3><span className="verification-state">{audioConfirmed ? '已确认' : '待验证'}</span></header>
      <div className="verification-source"><span>{draft.targetInputName || '尚未选择音源'}</span><strong>{level === null ? '—' : level.toFixed(1)} dB</strong></div>
      <div className="verification-meter" role="meter" aria-label="当前音源电平" aria-valuemin={-90} aria-valuemax={0} aria-valuenow={level === null ? undefined : Math.max(-90, Math.min(0, level))}><i style={{ transform: `scaleX(${level === null ? 0 : Math.max(0, Math.min(1, (level + 90) / 90))})` }} /></div>
      <p role="status">{!snapshot.connected ? '请先返回连接 OBS。' : !draft.targetInputName ? '请返回上一步选择音源。' : audioConfirmed ? '已确认这是需要守护的声音。' : heard ? '已收到声音，请确认音源。' : startedAt ? '请对着麦克风说一句话。' : '开始验证后，对着麦克风说一句话。'}</p>
      <div className="verification-actions">
        <button type="button" className="btn-secondary" disabled={!ready} onClick={() => { setHeardSource(''); setStartedAt(Date.now()); }}>开始验证</button>
        <button type="button" className="btn-primary" disabled={!ready || !heard || audioConfirmed} onClick={() => onVerified(heardSource)}>{audioConfirmed ? '音源已确认' : '确认声音正确'}</button>
      </div>
    </section>
    <section className="verification-panel">
      <header><span className="verification-number">2</span><h3>检查报警提醒</h3><span className="verification-state">{confirmed ? '已确认' : '待验证'}</span></header>
      <p>点击测试将打开报警窗口。若已开启提示音，请同时确认能听到声音。</p>
      <div className="verification-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void test()}>{busy ? '正在打开…' : '测试报警'}</button>
        <button type="button" className="btn-primary" disabled={!tested || busy || confirmed} onClick={onConfirmed}>{confirmed ? '提醒已确认' : '已看到报警提醒'}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  </div>;
}
