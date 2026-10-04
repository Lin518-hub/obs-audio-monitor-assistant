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
  return <div className="onboarding-card-body setup-verification">
    <h2>确认音频和提醒确实可用</h2>
    <p>选中音源：{draft.targetInputName || '尚未选择'}。点击开始验证，然后对着麦克风说一句话。</p>
    <meter aria-label="当前音源电平" min={-90} max={0} value={snapshot.lastLevelDb ?? -90} />
    <p role="status">{verifiedSource === draft.targetInputName && verifiedSource ? '音源已确认' : heardSource === draft.targetInputName && heardSource ? '收到声音，请确认这是需要守护的声音' : '等待说话验证'}</p>
    <button className="btn-secondary" disabled={!snapshot.connected || !draft.targetInputName} onClick={() => { setHeardSource(''); setStartedAt(Date.now()); }}>开始音频验证</button>
    <button className="btn-primary" disabled={!snapshot.connected || !heardSource || heardSource !== draft.targetInputName} onClick={() => onVerified(heardSource)}>确认是需要守护的声音</button>
    <hr />
    <p>测试会弹出实际报警窗口。请确认能看到提醒；开启提示音后还应确认能听到。</p>
    <button className="btn-secondary" disabled={busy} onClick={() => void test()}>{busy ? '正在打开…' : '测试报警'}</button>
    <button className="btn-primary" disabled={!tested || busy} onClick={onConfirmed}>{confirmed ? '已确认收到提醒' : '我已看到报警提醒'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
