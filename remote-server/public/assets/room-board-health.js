/* Shared, deterministic presentation rules for the read-only board. */
(() => {
  function classify(device, { now, stale, meter, speech } = {}) {
    const audio = device.audio || {}, obs = device.obs || {};
    const available = device.online && !stale && Number.isFinite(device.stateUpdatedAt) && now - device.stateUpdatedAt <= 30000;
    const base = { available: Boolean(available), level: null, silent: null, tone: 'safe', audioIssue: false };
    const result = (code, label, tone = 'safe', audioIssue = false) => ({ ...base, code, label, tone, audioIssue });
    if (!device.online) return result('offline', '电脑离线', 'offline');
    if (!available) return result('stale', '状态同步中断', 'offline');
    if (!obs.connected) return result('obs-disconnected', 'OBS 未连接', 'warning');
    const live = meter && meter.inputName === audio.inputName && now - meter.receivedAt < 1500;
    const snapshotFresh = Number.isFinite(audio.lastMeterReceivedAt) && now - audio.lastMeterReceivedAt <= 5000;
    base.level = live ? meter.levelDb : snapshotFresh ? audio.levelDb : null;
    if (!Number.isFinite(base.level)) base.level = null;
    if (!obs.monitoringActive) return result('disabled', '音频检测未开启');
    if (!audio.inputName || audio.inputName === '未选择音源') { base.level = null; return result('no-source', '未选择检测音源', 'warning', true); }
    if (base.level === null || (!live && audio.ready !== true)) { base.level = null; return result('no-data', '音源没有有效数据', 'warning', true); }
    const elapsed = speech?.inputName === audio.inputName ? Math.max(0, (now - speech.at) / 1000) : Infinity;
    base.silent = Math.min(Number.isFinite(audio.silentForSeconds) ? Math.max(0, audio.silentForSeconds) : 0, elapsed);
    if (live && Number.isFinite(audio.thresholdDb) && base.level > audio.thresholdDb) base.silent = 0;
    if (base.silent >= 300) return result('critical', '静音已满 5 分钟', 'critical', true);
    if (base.silent >= 180) return result('silent', '静音已满 3 分钟', 'danger', true);
    return result('healthy', base.silent === 0 ? '音频正常' : '暂未检测到讲话');
  }
  function bitrate(device, available) {
    const obs = device.obs || {};
    if (!available || !obs.connected) return { value: '—', note: '连接不可用' };
    if (!obs.streaming) return { value: '—', note: '未通过 OBS 推流' };
    if (Number.isFinite(obs.bitrateKbps)) return { value: `${Math.max(0, obs.bitrateKbps).toFixed(0)} kbps`, note: '实际推流速率' };
    const version = /^(\d+)\.(\d+)\.(\d+)/.exec(device.app?.version || '');
    const old = version && (Number(version[1]) < 3 || Number(version[1]) === 3 && (Number(version[2]) < 9 || Number(version[2]) === 9 && Number(version[3]) < 15));
    return { value: '—', note: old ? '请更新客户端以显示码率' : '等待两次有效推流采样' };
  }
  globalThis.roomBoardHealth = { classify, bitrate };
})();
