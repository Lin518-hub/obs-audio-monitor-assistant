const $ = (id) => document.getElementById(id);
const pairToken = decodeURIComponent(location.pathname.startsWith('/pair/') ? location.pathname.slice(6) : '');
const randomId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const clientId = localStorage.obsRemoteClientId || (localStorage.obsRemoteClientId = randomId());
let device = null, requestId = null, accessToken = null, socket = null, state = null, pollTimer = null, socketRetryTimer = null;
let socketRetryCount = 0, socketGeneration = 0, pipRenderTimer = null, pipVideoSyncTimer = null, fallbackPipActive = false;
let pipStarting = false, pipVideoPrepared = false, pipCaptionTrack = null, pipCaptionKey = '', pipFrameKey = '';
let pipVideoThresholdDb = -55, pipLastSeekAt = 0;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandaloneApp = navigator.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
const defaultClientName = () => {
  const agent = navigator.userAgent || '';
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(agent)) return 'Android 设备';
  return '浏览器控制设备';
};
$('client-name').value = localStorage.obsRemoteClientName || defaultClientName();
$('room-name').value = localStorage.obsRemoteRoomName || '';

const show = (id) => ['pair-view','pending-view','dashboard-view'].forEach((name) => $(name).classList.toggle('hidden', name !== id));
const toast = (message) => { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 2600); };
const api = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '请求失败');
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接服务器超时，请检查网络后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
const formatTime = (seconds = 0) => `${String(Math.floor(Math.max(0,seconds)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
const levelPct = (db) => db == null ? 0 : Math.max(0, Math.min(100, ((db + 90) / 85) * 100));

async function start() {
  if (!pairToken) {
    show('pair-view');
    $('request-access').disabled = true;
    $('pair-error').textContent = '请使用电脑端生成的二维码或扫码链接进入。';
    return;
  }
  try {
    const info = await api(`/api/pair/info?token=${encodeURIComponent(pairToken)}`);
    device = info.device;
    $('device-subtitle').textContent = device.roomName || device.label;
    setOnline(Boolean(device.online));
    if (!$('room-name').value) $('room-name').value = device.roomName || '';
    accessToken = localStorage[`obsRemoteAccess:${device.uuid}`] || null;
    if (accessToken) {
      try { await openDashboard(); return; } catch { localStorage.removeItem(`obsRemoteAccess:${device.uuid}`); accessToken = null; }
    }
    show('pair-view');
  } catch (error) {
    show('pair-view'); $('pair-error').textContent = error.message === 'pair_link_invalid' ? '二维码已失效，请在电脑端重新打开二维码。' : error.message;
  }
}

$('request-access').addEventListener('click', async () => {
  const roomName = $('room-name').value.trim(), clientName = $('client-name').value.trim() || defaultClientName();
  $('pair-error').textContent = '';
  if (roomName.length < 2) return $('pair-error').textContent = '请输入至少两个字的直播间名称。';
  try {
    localStorage.obsRemoteRoomName = roomName;
    localStorage.obsRemoteClientName = clientName || defaultClientName();
    const result = await api('/api/pair/request', { method:'POST', body:JSON.stringify({ pairToken, clientId, roomName, clientName }) });
    requestId = result.request.id; $('pending-room').textContent = roomName; show('pending-view'); pollRequest();
  } catch (error) { $('pair-error').textContent = error.message; }
});
$('cancel-request').addEventListener('click', () => { clearTimeout(pollTimer); show('pair-view'); });

async function pollRequest() {
  if (!requestId) return;
  try {
    const result = await api(`/api/pair/request/${encodeURIComponent(requestId)}?clientId=${encodeURIComponent(clientId)}`);
    if (result.request.status === 'approved' && result.accessToken) {
      accessToken = result.accessToken; localStorage[`obsRemoteAccess:${device.uuid}`] = accessToken; await openDashboard(); return;
    }
    if (result.request.status === 'rejected') { show('pair-view'); $('pair-error').textContent = '管理员已拒绝本次申请。'; return; }
  } catch {}
  pollTimer = setTimeout(pollRequest, 1800);
}

async function openDashboard() {
  const session = await api(`/api/mobile/session?token=${encodeURIComponent(accessToken)}`);
  device = session.device;
  state = session.state || {
    desktopOnline: false,
    audio: { ready:false, tone:'', inputName:'', levelDb:null, thresholdDb:-55, silentForSeconds:0, display:'--', hint:'等待电脑上传状态' },
    atem: { connected:false, programInput:0, previewInput:0, inputIds:[], inputLabels:{}, elapsedSeconds:0, limitSeconds:600, overLimit:false },
    obs: { connected:false, streaming:false, recording:false, fps:null, cpu:null, bitrateKbps:null }
  };
  show('dashboard-view'); render(); connectSocket();
}

function connectSocket() {
  clearTimeout(socketRetryTimer);
  const generation = ++socketGeneration;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws/mobile?token=${encodeURIComponent(accessToken)}`);
  socket.onopen = () => { if (generation === socketGeneration) socketRetryCount = 0; };
  socket.onmessage = (event) => {
    if (generation !== socketGeneration) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'state') { state = message.state; render(); }
      if (message.type === 'meter') renderMeter(message.meter || {});
      if (message.type === 'device-status') setOnline(message.online);
    } catch { /* Ignore malformed websocket data. */ }
  };
  socket.onclose = (event) => {
    if (generation !== socketGeneration) return;
    setOnline(false);
    if (event.code === 4003 || event.code === 4004) { localStorage.removeItem(`obsRemoteAccess:${device.uuid}`); location.reload(); return; }
    const delay = Math.min(15_000, 1500 * (2 ** Math.min(socketRetryCount, 3)));
    socketRetryCount += 1;
    socketRetryTimer = setTimeout(connectSocket, delay);
  };
}

function setOnline(online) { $('online-chip').textContent = online ? '电脑在线' : '电脑离线'; $('online-chip').classList.toggle('offline', !online); }
function setPill(element, text, tone='') { element.textContent = text; element.className = `state-pill ${tone}`; }
function audioPresentation(audio = {}) {
  const phase = audio.phase || (audio.ready ? (audio.tone === 'danger' ? 'alert' : audio.display === '正在讲话' ? 'speaking' : 'silent') : 'idle');
  if (phase === 'alert') return { label: '报警', tone: 'danger' };
  if (phase === 'silent') return { label: '静音计时', tone: audio.tone === 'danger' ? 'danger' : 'warning' };
  if (phase === 'speaking') return { label: '音频正常', tone: audio.tone || 'safe' };
  return { label: '未就绪', tone: '' };
}
const PIP_LEVEL_STEPS = 40;
const PIP_LEVEL_CELLS = PIP_LEVEL_STEPS + 1;
const PIP_THRESHOLD_MIN_DB = -90;
const PIP_THRESHOLD_MAX_DB = -5;
const PIP_THRESHOLD_STEP_DB = 5;
const PIP_CELL_DURATION = 0.2;
const PIP_SYNC_MIN_INTERVAL_MS = 120;
function pipThresholdAssetDb(value) {
  const threshold = Math.max(PIP_THRESHOLD_MIN_DB, Math.min(PIP_THRESHOLD_MAX_DB, Number(value) || -55));
  return Math.max(PIP_THRESHOLD_MIN_DB, Math.min(PIP_THRESHOLD_MAX_DB, Math.round(threshold / PIP_THRESHOLD_STEP_DB) * PIP_THRESHOLD_STEP_DB));
}
function pipVideoSource(thresholdDb) {
  return `/assets/pip-audio-threshold-${Math.abs(thresholdDb)}.mp4?v=3.6.1`;
}
function pipVisualMode(audio = {}) {
  const view = audioPresentation(audio);
  if (view.label === '未就绪') return 0;
  if (view.label === '音频正常') return 1;
  if (view.label === '报警') return 6;
  const limit = Math.max(10, Number(audio.silenceDurationSeconds) || 120);
  const silent = Math.max(0, Number(audio.silentForSeconds) || 0);
  const ratio = Math.min(1, silent / limit);
  if (limit - silent <= 10) return 6;
  if (ratio >= 0.75) return 5;
  if (ratio >= 0.5) return 4;
  if (ratio >= 0.25) return 3;
  return 2;
}
function renderMeter(meter) {
  if (!state) return;
  state.audio ||= {};
  if (typeof meter.activeInputName === 'string' && meter.activeInputName) state.audio.inputName = meter.activeInputName;
  state.audio.levelDb = typeof meter.levelDb === 'number' && Number.isFinite(meter.levelDb) ? meter.levelDb : null;
  $('audio-input').textContent = state.audio.inputName || '未选择音源';
  $('audio-db').textContent = state.audio.levelDb == null ? '-- dB' : `${state.audio.levelDb.toFixed(1)} dB`;
  $('audio-level').style.transform = `scaleX(${levelPct(state.audio.levelDb) / 100})`;
  drawPipFrame();
}
function render() {
  if (!state) return;
  const audio = state.audio || {}, atem = state.atem || {}, obs = state.obs || {};
  $('device-subtitle').textContent = device?.roomName || device?.label || '远程监看'; setOnline(Boolean(state.desktopOnline ?? true));
  $('audio-input').textContent = audio.inputName || '未选择音源'; $('audio-status').textContent = audio.display || '--'; $('audio-db').textContent = audio.levelDb == null ? '-- dB' : `${audio.levelDb.toFixed(1)} dB`;
  $('audio-level').style.transform = `scaleX(${levelPct(audio.levelDb) / 100})`; $('audio-threshold').style.left = `${levelPct(audio.thresholdDb)}%`; $('audio-hint').textContent = audio.hint || '等待状态'; $('audio-silence').textContent = audio.silentForSeconds ? `${audio.silentForSeconds}s` : '';
  const audioView = audioPresentation(audio);
  setPill($('audio-state-chip'), audioView.label, audioView.tone);
  const labels = atem.inputLabels || {}; $('camera-number').textContent = `PGM ${atem.programInput || '--'}`; $('camera-name').textContent = labels[atem.programInput] || '未读取机位'; $('camera-time').textContent = formatTime(atem.elapsedSeconds);
  const limit = Math.max(10, atem.limitSeconds || 600), progress = Math.min(100,(atem.elapsedSeconds||0)/limit*100); $('camera-progress').style.width = `${progress}%`; $('camera-hint').textContent = atem.overLimit ? `已超时 ${formatTime(atem.elapsedSeconds-limit)}` : `剩余 ${formatTime(limit-(atem.elapsedSeconds||0))}`; $('preview-summary').textContent = `PVW ${atem.previewInput || '--'}`;
  setPill($('camera-state-chip'), !atem.connected ? '未连接' : atem.overLimit ? '机位超时' : '计时中', atem.overLimit ? 'danger' : atem.elapsedSeconds >= limit*.75 ? 'warning' : '');
  $('obs-live').textContent = obs.streaming ? '直播中' : obs.recording ? '录制中' : obs.connected ? '待机' : '未连接'; $('obs-live').classList.toggle('offline', !obs.connected); $('obs-fps').textContent = obs.fps == null ? '--' : Math.round(obs.fps); $('obs-cpu').textContent = obs.cpu == null ? '--' : `${Math.round(obs.cpu)}%`; $('obs-bitrate').textContent = obs.bitrateKbps == null ? '--' : Math.round(obs.bitrateKbps);
  drawPipFrame();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fitText(context, value, maxWidth) {
  const text = String(value || '');
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function drawPipFrame() {
  const canvas = $('pip-canvas');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const audio = state?.audio || {};
  const width = canvas.width, height = canvas.height;
  const level = levelPct(audio.levelDb) / 100;
  const threshold = levelPct(audio.thresholdDb) / 100;
  const audioTone = audio.tone === 'danger' ? '#ef4444' : audio.tone === 'warning' ? '#eab308' : '#22c55e';
  const audioView = audioPresentation(audio);
  const statusText = audioView.label === '报警' ? '麦克风无声' : audioView.label === '静音计时' ? '静音计时中' : audioView.label === '音频正常' ? '音频正常' : '等待音频';
  const glow = audio.tone === 'danger' ? 'rgba(239,68,68,.2)' : audio.tone === 'warning' ? 'rgba(234,179,8,.18)' : 'rgba(34,197,94,.18)';

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#171a21';
  roundedRect(context, 0, 0, width, height, 24);
  context.fill();
  const accent = context.createLinearGradient(0, 0, width, height);
  accent.addColorStop(0, glow);
  accent.addColorStop(.72, 'rgba(15,23,42,0)');
  context.fillStyle = accent;
  roundedRect(context, 0, 0, width, height, 24);
  context.fill();

  context.fillStyle = audioTone;
  context.beginPath();
  context.arc(28, 28, 7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f8fafc';
  context.font = '700 20px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText('音频守护', 46, 35);
  context.fillStyle = audioTone;
  context.font = '700 13px -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'right';
  context.fillText(statusText, width - 24, 34);

  context.textAlign = 'left';
  context.fillStyle = '#94a3b8';
  context.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(fitText(context, audio.inputName || '未选择麦克风', 360), 24, 82);
  context.fillStyle = '#f8fafc';
  context.font = '800 38px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(fitText(context, audio.display || '--', 360), 24, 126);
  context.textAlign = 'right';
  context.font = '800 34px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(audio.levelDb == null ? '-- dB' : `${audio.levelDb.toFixed(1)} dB`, width - 24, 124);

  context.fillStyle = '#343943';
  roundedRect(context, 24, 151, width - 48, 12, 6);
  context.fill();
  if (level > 0) {
    const meter = context.createLinearGradient(24, 0, width - 24, 0);
    meter.addColorStop(0, '#22c55e');
    meter.addColorStop(.72, '#eab308');
    meter.addColorStop(1, '#f87171');
    context.fillStyle = meter;
    roundedRect(context, 24, 151, Math.max(6, (width - 48) * level), 12, 6);
    context.fill();
  }
  context.fillStyle = '#cbd5e1';
  context.fillRect(24 + (width - 48) * threshold - 1, 147, 2, 20);

  context.textAlign = 'left';
  context.fillStyle = '#94a3b8';
  context.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(fitText(context, audio.hint || '等待麦克风状态', 430), 24, 205);
  context.textAlign = 'right';
  context.fillStyle = audio.silentForSeconds ? audioTone : '#64748b';
  context.font = '700 13px -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText(audio.silentForSeconds ? `已静音 ${audio.silentForSeconds}s` : '实时麦克风监测', width - 24, 205);

  syncPipVideoFrame();
  updatePipCaption();
}

function syncPipVideoFrame(force = false) {
  const video = $('pip-video');
  if (video.readyState < HTMLMediaElement.HAVE_METADATA || !Number.isFinite(video.duration)) return;
  const current = performance.now();
  if (!force && current - pipLastSeekAt < PIP_SYNC_MIN_INTERVAL_MS) return;
  const audio = state?.audio || {};
  const mode = pipVisualMode(audio);
  const levelIndex = Math.round(levelPct(audio.levelDb) / 100 * PIP_LEVEL_STEPS);
  const cell = mode * PIP_LEVEL_CELLS + levelIndex;
  const start = cell * PIP_CELL_DURATION;
  const target = start + 0.06;
  const end = start + PIP_CELL_DURATION - 0.06;
  const key = `${mode}:${levelIndex}`;
  if (!force && key === pipFrameKey && video.currentTime >= start && video.currentTime <= end) return;
  pipFrameKey = key;
  pipLastSeekAt = current;
  video.currentTime = Math.min(target, Math.max(0, video.duration - 0.1));
}

function startPipVideoSync() {
  clearInterval(pipVideoSyncTimer);
  syncPipVideoFrame(true);
  pipVideoSyncTimer = setInterval(syncPipVideoFrame, 120);
}

function stopPipVideoSync() {
  clearInterval(pipVideoSyncTimer);
  pipVideoSyncTimer = null;
}

function ensurePipCaptionTrack() {
  if (pipCaptionTrack) return pipCaptionTrack;
  const video = $('pip-video');
  if (typeof video.addTextTrack !== 'function') return null;
  pipCaptionTrack = video.addTextTrack('captions', '麦克风状态', 'zh-CN');
  pipCaptionTrack.mode = 'showing';
  return pipCaptionTrack;
}

function updatePipCaption() {
  const track = ensurePipCaptionTrack();
  if (!track || typeof globalThis.VTTCue !== 'function') return;
  const audio = state?.audio || {};
  const inputName = audio.inputName || '未选择麦克风';
  const audioView = audioPresentation(audio);
  const status = audioView.label === '报警' ? '麦克风无声' : audioView.label === '静音计时' ? '静音计时中' : audioView.label === '音频正常' ? '音频正常' : '等待音频';
  const level = audio.levelDb == null ? '-- dB' : `${audio.levelDb.toFixed(1)} dB`;
  const key = `${inputName}|${status}|${level}`;
  if (key === pipCaptionKey) return;
  pipCaptionKey = key;
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  const cue = new VTTCue(0, 86_400, `${inputName}\n${status}  ${level}`);
  cue.align = 'center';
  cue.line = 'auto';
  track.addCue(cue);
}

function configurePipVideo() {
  const video = $('pip-video');
  const nextThresholdDb = pipThresholdAssetDb(state?.audio?.thresholdDb);
  const systemPipActive = document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
  if (nextThresholdDb !== pipVideoThresholdDb && !systemPipActive) {
    video.pause();
    pipVideoThresholdDb = nextThresholdDb;
    pipVideoPrepared = false;
    pipFrameKey = '';
    video.src = pipVideoSource(nextThresholdDb);
    video.load();
  }
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.removeAttribute('disablepictureinpicture');
  ensurePipCaptionTrack();
  updatePipCaption();
  return video;
}

function primePipVideo() {
  const video = configurePipVideo();
  const markReady = () => {
    if (video.videoWidth > 0) pipVideoPrepared = true;
    updatePipCaption();
  };
  video.addEventListener('loadedmetadata', markReady);
  video.addEventListener('canplay', markReady);
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) markReady();
  void video.play().then(markReady).catch(() => { /* The first tap will start playback. */ });
}

function setPipButton(active, label = '画中画') {
  const button = $('pip-monitor');
  button.classList.toggle('active', active);
  button.textContent = label;
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function stopPipRenderer() {
  clearInterval(pipRenderTimer);
  pipRenderTimer = null;
}

function releasePipStream() {
  const video = $('pip-video');
  video.pause();
  stopPipVideoSync();
  pipVideoPrepared = video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0;
  $('pip-media').classList.remove('pip-ready');
}

function closePipSurface() {
  fallbackPipActive = false;
  $('pip-media').classList.remove('fallback-active', 'pip-ready');
  $('pip-media').setAttribute('aria-hidden', 'true');
  setPipButton(false);
  stopPipRenderer();
  releasePipStream();
}

function useInlinePipFallback(message) {
  fallbackPipActive = true;
  $('pip-media').classList.add('fallback-active');
  $('pip-media').setAttribute('aria-hidden', 'false');
  setPipButton(true, '已悬浮');
  drawPipFrame();
  stopPipRenderer();
  pipRenderTimer = setInterval(drawPipFrame, 500);
  toast(message || '当前浏览器使用页面内悬浮监看');
}

function waitForVideoMetadata(video, timeoutMs = 3200) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('pip_metadata_timeout')), timeoutMs);
    const finish = (error) => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('error', handleError);
      if (error) reject(error); else resolve();
    };
    const handleReady = () => {
      if (video.videoWidth > 0) finish();
    };
    const handleError = () => finish(new Error('pip_video_failed'));
    video.addEventListener('loadedmetadata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('error', handleError);
  });
}

async function preparePipVideo() {
  const video = configurePipVideo();
  if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.videoWidth <= 0) {
    video.load();
    await waitForVideoMetadata(video, 6000);
  }
  await video.play();
  startPipVideoSync();
  updatePipCaption();
  pipVideoPrepared = true;
  return video;
}

async function enterSystemPip(video) {
  let standardError = null;
  if (isIOS && typeof video.webkitSetPresentationMode === 'function') {
    const supportsPip = typeof video.webkitSupportsPresentationMode !== 'function'
      || video.webkitSupportsPresentationMode('picture-in-picture');
    if (supportsPip) {
      video.webkitSetPresentationMode('picture-in-picture');
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (video.webkitPresentationMode === 'picture-in-picture') return true;
    }
  }
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
    try {
      await video.requestPictureInPicture();
      return true;
    } catch (error) {
      standardError = error;
    }
  }
  if (!isIOS && typeof video.webkitSetPresentationMode === 'function') {
    const supportsPip = typeof video.webkitSupportsPresentationMode !== 'function'
      || video.webkitSupportsPresentationMode('picture-in-picture');
    if (supportsPip) {
      video.webkitSetPresentationMode('picture-in-picture');
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (video.webkitPresentationMode === 'picture-in-picture') return true;
    }
  }
  throw standardError || new Error('pip_unsupported');
}

function pipFallbackMessage(error) {
  if (isStandaloneApp && isIOS) return '主屏幕 Web App 暂不支持系统画中画，请用 Safari 打开链接；已使用页面内悬浮窗';
  if (isIOS && error?.message === 'pip_video_failed') return '画中画视频加载失败，请刷新页面重试；已使用页面内悬浮窗';
  if (isIOS) return '此 Safari 未允许网页进入系统画中画，已使用页面内悬浮监看';
  return '系统画中画不可用，已切换为页面内悬浮监看';
}

async function openPictureInPicture() {
  const video = $('pip-video');
  if (pipStarting) return;
  if (fallbackPipActive) return closePipSurface();
  if (video.webkitPresentationMode === 'picture-in-picture') {
    video.webkitSetPresentationMode('inline');
    return;
  }
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }
  configurePipVideo();
  pipStarting = true;
  $('pip-monitor').disabled = true;
  setPipButton(false, pipVideoPrepared ? '正在打开' : '正在准备');
  try {
    if (isIOS && !pipVideoPrepared) {
      await preparePipVideo();
      $('pip-media').classList.add('pip-ready');
      $('pip-media').setAttribute('aria-hidden', 'false');
      setPipButton(false, '再次点击进入');
      toast('视频已准备好，请再次点击“再次点击进入”打开系统画中画');
      return;
    }
    const video = pipVideoPrepared ? $('pip-video') : await preparePipVideo();
    await enterSystemPip(video);
    $('pip-media').classList.remove('pip-ready');
    $('pip-media').setAttribute('aria-hidden', 'true');
    setPipButton(true, '画中画中');
  } catch (error) {
    releasePipStream();
    useInlinePipFallback(pipFallbackMessage(error));
  } finally {
    pipStarting = false;
    $('pip-monitor').disabled = false;
  }
}

$('pip-monitor').addEventListener('click', () => void openPictureInPicture());
$('pip-fallback-close').addEventListener('click', closePipSurface);
$('pip-video').addEventListener('enterpictureinpicture', () => setPipButton(true, '画中画中'));
$('pip-video').addEventListener('enterpictureinpicture', startPipVideoSync);
$('pip-video').addEventListener('leavepictureinpicture', () => { setPipButton(false); stopPipRenderer(); releasePipStream(); });
$('pip-video').addEventListener('webkitpresentationmodechanged', (event) => {
  if (event.target.webkitPresentationMode === 'picture-in-picture') { setPipButton(true, '画中画中'); startPipVideoSync(); }
  else if (!pipStarting) { setPipButton(false); stopPipRenderer(); releasePipStream(); }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (document.pictureInPictureElement || $('pip-video').webkitPresentationMode === 'picture-in-picture')) updatePipCaption();
});
start();
primePipVideo();
