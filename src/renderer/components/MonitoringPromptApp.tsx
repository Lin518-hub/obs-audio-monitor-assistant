import React, { useState } from 'react';

export const MonitoringPromptApp: React.FC = () => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const respond = async (accept: boolean) => {
    setPending(true);
    try { await window.obsGuard.respondMonitoringPrompt(accept); }
    catch { setError('操作失败，请在主界面开始检测'); setPending(false); }
  };
  return <main className="monitoring-prompt" role="dialog" aria-labelledby="monitoring-prompt-title">
    <strong id="monitoring-prompt-title">虚拟摄像头已开启，是否开始检测？</strong>
    <p>{error || '音频和机位检测尚未启动。此提示 5 秒后自动关闭。'}</p>
    <div><button disabled={pending} onClick={() => void respond(false)}>暂不开启</button>
      <button className="btn-primary" disabled={pending} onClick={() => void respond(true)}>开始检测</button></div>
  </main>;
};
