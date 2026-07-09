import type { AppConfig, AppSnapshot, MonitorStatus, ReadinessReason, UpdateSnapshot } from '../../shared/types';

// =====================================================================
// 静音/电平工具
// =====================================================================

export const dbLevelPercent = (levelDb: number | null): number => {
  if (levelDb === null) {
    return 0;
  }
  return Math.max(0, Math.min(100, ((levelDb + 90) / 90) * 100));
};

export const thresholdPercent = (thresholdDb: number): number => {
  return Math.max(0, Math.min(100, ((thresholdDb + 90) / 85) * 100));
};

export const displayedSilenceSeconds = (snapshot: AppSnapshot): number => {
  if (snapshot.silentForSeconds < 3) {
    return 0;
  }
  return snapshot.silentForSeconds;
};

export const secondsUntilVisibleAlert = (snapshot: AppSnapshot): number => {
  return Math.max(0, snapshot.config.silenceDurationSeconds - displayedSilenceSeconds(snapshot));
};

export const audioStateKind = (snapshot: AppSnapshot): 'normal' | 'silent' | 'other' => {
  if (snapshot.readinessReason !== 'ready') {
    return 'other';
  }
  return displayedSilenceSeconds(snapshot) === 0 ? 'normal' : 'silent';
};

// =====================================================================
// 状态文字
// =====================================================================

export const statusText = (status: MonitorStatus): string => {
  const labels: Record<string, string> = {
    disconnected: 'OBS 未连接',
    connecting: '正在连接 OBS',
    idle_not_streaming: '等待直播/录制',
    monitoring: '检测中',
    silent_counting: '静音计时中',
    pre_alert: '静音计时中',
    alerting: '正在提醒',
    snoozed: '已延后检测',
    ignored_until_audio_returns: '本次已忽略',
    paused: '检测已暂停',
    error: '状态异常'
  };
  return labels[status] ?? status;
};

export const displayStatusText = (snapshot: AppSnapshot): string => {
  if (audioStateKind(snapshot) === 'normal') {
    return '检测中';
  }
  if (audioStateKind(snapshot) === 'silent') {
    return '静音计时中';
  }
  return statusText(snapshot.status);
};

export const silenceMetricText = (snapshot: AppSnapshot): string => {
  if (audioStateKind(snapshot) === 'normal') {
    return '正在讲话';
  }
  if (audioStateKind(snapshot) === 'silent') {
    return `${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告`;
  }
  return statusText(snapshot.status);
};

// =====================================================================
// 横幅/色调
// =====================================================================

export const snapshotTone = (snapshot: AppSnapshot): 'safe' | 'warning' | 'danger' | 'idle' => {
  if (snapshot.alertVisible) {
    return 'danger';
  }
  if (snapshot.preAlertVisible) {
    return 'warning';
  }
  return snapshot.readinessReason === 'ready' ? 'safe' : 'idle';
};

export const floatingTone = (snapshot: AppSnapshot): 'safe' | 'warning' | 'danger' | 'idle' => {
  if (snapshot.alertVisible || (snapshot.secondsUntilAlert !== null && snapshot.secondsUntilAlert <= 10)) {
    return 'danger';
  }
  const displayedSilent = displayedSilenceSeconds(snapshot);
  if (snapshot.preAlertVisible || (displayedSilent >= 30 && displayedSilent % 30 < 5)) {
    return 'warning';
  }
  return snapshotTone(snapshot);
};

export const floatingEmphasis = (snapshot: AppSnapshot): string => {
  if (snapshot.alertVisible || (snapshot.secondsUntilAlert !== null && snapshot.secondsUntilAlert <= 10)) {
    return 'critical-emphasis';
  }
  const displayedSilent = displayedSilenceSeconds(snapshot);
  if (snapshot.preAlertVisible || (displayedSilent >= 30 && displayedSilent % 30 < 5)) {
    return 'soft-emphasis';
  }
  return '';
};

export const floatingHint = (snapshot: AppSnapshot): string => {
  if (snapshot.alertVisible) {
    return '已触发报警';
  }
  if (audioStateKind(snapshot) === 'normal') {
    return '音频正常';
  }
  if (audioStateKind(snapshot) === 'silent') {
    return `${secondsUntilVisibleAlert(snapshot)}s 后弹窗警告`;
  }
  return readinessText(snapshot);
};

// =====================================================================
// 安全横幅文案(原 readinessText / readinessActionText)
// =====================================================================

const readinessReasonText: Record<string, (s: AppSnapshot) => string> = {
  ready: (s) =>
    audioStateKind(s) === 'normal'
      ? '检测中，正在讲话，音频正常。'
      : `静音计时中，已静音 ${displayedSilenceSeconds(s)} 秒，${secondsUntilVisibleAlert(s)}s 后弹窗警告。`,
  obs_disconnected: () => 'OBS 未连接，请确认 OBS 已打开且 WebSocket 已启用。',
  obs_connecting: () => '正在连接 OBS WebSocket。',
  not_streaming_or_recording: () => 'OBS 当前未直播或录制，暂不检测。',
  no_target_selected: () => '请选择需要监听的 OBS 音频源。',
  target_missing: () => '目标音源不在 OBS 输入源列表中，请刷新或重新选择。',
  no_target_meter: () => '暂时没有收到目标音源电平数据，请确认该源处于活动状态。',
  paused: () => '检测已手动暂停。',
  snoozed: (s) =>
    s.snoozedUntil ? `已延后检测，将在 ${new Date(s.snoozedUntil).toLocaleTimeString()} 后恢复。` : '已延后检测。',
  alerting: () => '目标音源静音超时，请处理报警弹窗。',
  error: (s) => s.errorMessage ?? '检测状态异常。'
};

export const readinessText = (snapshot: AppSnapshot): string => {
  const fn = readinessReasonText[snapshot.readinessReason as ReadinessReason];
  return fn ? fn(snapshot) : '正在读取状态。';
};

const readinessActionTextMap: Record<string, (s: AppSnapshot) => string> = {
  ready: (s) =>
    audioStateKind(s) === 'normal'
      ? '音频正常，继续检测。'
      : `${secondsUntilVisibleAlert(s)}s 后弹窗警告，请确认主播是否真的没有讲话。`,
  obs_disconnected: () => '下一步：打开 OBS，并确认 WebSocket 服务已启用。',
  obs_connecting: () => '正在自动连接，必要时点击"重连 OBS"。',
  not_streaming_or_recording: () => '开播或开始录制后会自动进入检测。',
  no_target_selected: () => '下一步：在"检测与报警"里选择主播麦克风或直播主混音。',
  target_missing: () => '下一步：刷新音源列表，或在 OBS 中恢复这个音源。',
  no_target_meter: () => '下一步：确认该源在当前场景中处于活动状态。',
  paused: () => '需要恢复时点击右侧"恢复检测"。',
  snoozed: () => '忽略倒计时结束后会自动恢复检测。',
  alerting: () => '请处理报警弹窗中的"确定"或"单次忽略"。',
  error: () => '请查看错误信息，必要时重连 OBS。'
};

export const readinessActionText = (snapshot: AppSnapshot): string => {
  const fn = readinessActionTextMap[snapshot.readinessReason as ReadinessReason];
  return fn ? fn(snapshot) : '等待状态更新。';
};

export const safetyTitle = (snapshot: AppSnapshot): string => {
  if (snapshot.alertVisible) {
    return '正在报警';
  }
  if (snapshot.readinessReason === 'ready') {
    return audioStateKind(snapshot) === 'normal' ? '正在讲话' : '静音计时中';
  }
  return '尚未进入检测';
};

// =====================================================================
// 更新/更新菜单
// =====================================================================

export type UpdateTone = 'idle' | 'info' | 'warning' | 'success' | 'error';

export const updateTone = (state: UpdateSnapshot): UpdateTone => {
  switch (state.status) {
    case 'available':
      return 'warning';
    case 'downloaded':
      return 'success';
    case 'checking':
    case 'downloading':
      return 'info';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
};

export const updateTriggerLabel = (state: UpdateSnapshot): string => {
  switch (state.status) {
    case 'checking':
      return '检查更新中';
    case 'available':
      return state.availableVersion ? `可更新 v${state.availableVersion}` : '发现更新';
    case 'downloading':
      return state.percent === null ? '下载更新中' : `下载 ${Math.round(state.percent)}%`;
    case 'downloaded':
      return state.installMode === 'manual' ? '打开安装包' : '重启安装更新';
    case 'error':
      return '更新失败';
    case 'not_available':
      return '已是新版';
    case 'unsupported':
      return '更新';
    default:
      return '检查更新';
  }
};

export const updateMenuTitle = (state: UpdateSnapshot): string => {
  switch (state.status) {
    case 'available':
      return state.availableVersion ? `发现 v${state.availableVersion}` : '发现新版本';
    case 'downloading':
      return '正在下载';
    case 'downloaded':
      return state.downloadedVersion ? `v${state.downloadedVersion} 已下载` : '更新已下载';
    case 'error':
      return '更新源暂时不可用';
    case 'not_available':
      return '当前为最新版本';
    case 'checking':
      return '正在检查更新';
    default:
      return '检查 GitHub 更新';
  }
};

// =====================================================================
// 音源类型翻译
// =====================================================================

export const readableInputKind = (inputKind: string): string => {
  if (inputKind.includes('wasapi') || inputKind.includes('coreaudio') || inputKind.includes('pulse') || inputKind.includes('alsa')) {
    return '系统音频 / 麦克风';
  }
  if (inputKind.includes('media') || inputKind.includes('ffmpeg') || inputKind.includes('vlc')) {
    return '媒体源';
  }
  if (inputKind.includes('browser')) {
    return '浏览器源';
  }
  if (inputKind.includes('dshow') || inputKind.includes('capture')) {
    return '采集设备';
  }
  if (inputKind === 'demo_input') {
    return '演示音源';
  }
  return inputKind || 'OBS 输入源';
};

// =====================================================================
// 显示辅助
// =====================================================================

export const formatDb = (value: number | null): string => {
  if (value === null) {
    return '--';
  }
  return `${value.toFixed(1)} dB`;
};

export const snapshotErrorMessage = (snapshot: AppSnapshot): string | null => snapshot.errorMessage;

export const liveStatusLabel = (snapshot: AppSnapshot): string => {
  if (snapshot.simulatedLive) return '模拟开播';
  if (snapshot.streaming) return '进行中';
  return '未开始';
};

export const recordingStatusLabel = (snapshot: AppSnapshot): string => {
  if (snapshot.recording) return '进行中';
  return '未开始';
};

export const snapshotTargetName = (snapshot: AppSnapshot): string =>
  snapshot.config.targetInputName || '未选择音源';

export const snapshotLiveStateLabel = (snapshot: AppSnapshot): string => {
  if (snapshot.simulatedLive) return '模拟开播';
  if (snapshot.streaming) return '直播中';
  if (snapshot.recording) return '录制中';
  return '未开播';
};

// 首次安装或版本更新后展示引导；不重置已有配置。
export const shouldShowOnboarding = (config: AppConfig, currentVersion: string): boolean => {
  return !config.hasSeenGuide || config.guideSeenVersion !== currentVersion;
};

export const isFirstRun = shouldShowOnboarding;
