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
let socketRetryCount = 0, socketGeneration = 0, commandInFlight = false, inputSignature = '';
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
      if (message.type === 'command-result') {
        commandInFlight = false;
        render();
        toast(message.ok ? '操作已执行' : message.message || '操作失败');
      }
    } catch { /* Ignore malformed websocket data. */ }
  };
  socket.onclose = (event) => {
    if (generation !== socketGeneration) return;
    setOnline(false);
    commandInFlight = false;
    if (event.code === 4003 || event.code === 4004) { localStorage.removeItem(`obsRemoteAccess:${device.uuid}`); location.reload(); return; }
    const delay = Math.min(15_000, 1500 * (2 ** Math.min(socketRetryCount, 3)));
    socketRetryCount += 1;
    socketRetryTimer = setTimeout(connectSocket, delay);
  };
}

function setOnline(online) { $('online-chip').textContent = online ? '电脑在线' : '电脑离线'; $('online-chip').classList.toggle('offline', !online); }
function setPill(element, text, tone='') { element.textContent = text; element.className = `state-pill ${tone}`; }
function renderMeter(meter) {
  if (!state) return;
  state.audio ||= {};
  if (typeof meter.activeInputName === 'string' && meter.activeInputName) state.audio.inputName = meter.activeInputName;
  state.audio.levelDb = typeof meter.levelDb === 'number' ? meter.levelDb : null;
  $('audio-input').textContent = state.audio.inputName || '未选择音源';
  $('audio-db').textContent = state.audio.levelDb == null ? '-- dB' : `${state.audio.levelDb.toFixed(1)} dB`;
  $('audio-level').style.transform = `scaleX(${levelPct(state.audio.levelDb) / 100})`;
}
function render() {
  if (!state) return;
  const audio = state.audio || {}, atem = state.atem || {}, obs = state.obs || {};
  $('device-subtitle').textContent = device?.roomName || device?.label || '远程监看'; setOnline(Boolean(state.desktopOnline ?? true));
  $('audio-input').textContent = audio.inputName || '未选择音源'; $('audio-status').textContent = audio.display || '--'; $('audio-db').textContent = audio.levelDb == null ? '-- dB' : `${audio.levelDb.toFixed(1)} dB`;
  $('audio-level').style.transform = `scaleX(${levelPct(audio.levelDb) / 100})`; $('audio-threshold').style.left = `${levelPct(audio.thresholdDb)}%`; $('audio-hint').textContent = audio.hint || '等待状态'; $('audio-silence').textContent = audio.silentForSeconds ? `${audio.silentForSeconds}s` : '';
  setPill($('audio-state-chip'), audio.tone === 'danger' ? '报警' : audio.tone === 'warning' ? '静音计时' : audio.ready ? '音频正常' : '未就绪', audio.tone || '');
  const labels = atem.inputLabels || {}; $('camera-number').textContent = `PGM ${atem.programInput || '--'}`; $('camera-name').textContent = labels[atem.programInput] || '未读取机位'; $('camera-time').textContent = formatTime(atem.elapsedSeconds);
  const limit = Math.max(10, atem.limitSeconds || 600), progress = Math.min(100,(atem.elapsedSeconds||0)/limit*100); $('camera-progress').style.width = `${progress}%`; $('camera-hint').textContent = atem.overLimit ? `已超时 ${formatTime(atem.elapsedSeconds-limit)}` : `剩余 ${formatTime(limit-(atem.elapsedSeconds||0))}`; $('preview-summary').textContent = `PVW ${atem.previewInput || '--'}`;
  setPill($('camera-state-chip'), !atem.connected ? '未连接' : atem.overLimit ? '机位超时' : '计时中', atem.overLimit ? 'danger' : atem.elapsedSeconds >= limit*.75 ? 'warning' : '');
  $('obs-live').textContent = obs.streaming ? '直播中' : obs.recording ? '录制中' : obs.connected ? '待机' : '未连接'; $('obs-live').classList.toggle('offline', !obs.connected); $('obs-fps').textContent = obs.fps == null ? '--' : Math.round(obs.fps); $('obs-cpu').textContent = obs.cpu == null ? '--' : `${Math.round(obs.cpu)}%`; $('obs-bitrate').textContent = obs.bitrateKbps == null ? '--' : Math.round(obs.bitrateKbps);
  $('atem-connection').textContent = atem.connected ? '已连接' : '未连接'; $('atem-connection').classList.toggle('offline', !atem.connected); $('program-strip').textContent = `${atem.programInput || '--'} ${labels[atem.programInput] || ''}`; $('preview-strip').textContent = `${atem.previewInput || '--'} ${labels[atem.previewInput] || ''}`;
  $('auto-transition').disabled = commandInFlight || !atem.connected || !atem.previewInput; renderInputs(atem);
}

function renderInputs(atem) {
  const root = $('atem-inputs');
  const nextSignature = JSON.stringify([atem.inputIds || [], atem.inputLabels || {}]);
  if (inputSignature !== nextSignature) {
    inputSignature = nextSignature;
    root.replaceChildren();
  }
  const existing = new Map(Array.from(root.querySelectorAll('.input-button')).map((button) => [Number(button.dataset.input), button]));
  for (const input of atem.inputIds || []) {
    let button = existing.get(input);
    if (!button) {
      button = document.createElement('button'); button.dataset.input = String(input); button.className = 'input-button';
      button.append(document.createElement('strong'), document.createElement('span'));
      button.addEventListener('click',()=>sendCommand('atem.preview',{input})); root.append(button);
    }
    button.disabled = commandInFlight;
    button.className = `input-button ${input===atem.programInput?'program':''} ${input===atem.previewInput?'preview':''}`;
    button.querySelector('strong').textContent = atem.inputLabels?.[input] || `Input ${input}`;
    button.querySelector('span').textContent = input===atem.programInput?'正在播出':input===atem.previewInput?'当前预览':'点击选入 PVW';
  }
  if (!root.children.length) { const empty=document.createElement('p'); empty.className='safe-tip'; empty.textContent='ATEM 未连接或暂无可用信号源'; root.append(empty); }
}

function sendCommand(command,payload={}) {
  if (!socket || socket.readyState!==WebSocket.OPEN) return toast('电脑当前离线');
  if (commandInFlight) return toast('上一项操作仍在执行');
  commandInFlight = true;
  render();
  try {
    socket.send(JSON.stringify({type:'command',id:randomId(),command,payload}));
  } catch {
    commandInFlight = false;
    render();
    toast('操作发送失败，请检查网络');
  }
}
document.querySelectorAll('.mobile-tabs button').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('.mobile-tabs button').forEach((item)=>item.classList.toggle('active',item===button));$('monitor-tab').classList.toggle('hidden',button.dataset.tab!=='monitor');$('atem-tab').classList.toggle('hidden',button.dataset.tab!=='atem');}));
$('auto-transition').addEventListener('click',()=>{const atem=state?.atem||{},labels=atem.inputLabels||{};$('confirm-copy').textContent=`PVW ${atem.previewInput || '--'} ${labels[atem.previewInput]||''} 将切换到 PGM。`;$('confirm-sheet').classList.remove('hidden');});
$('cancel-auto').addEventListener('click',()=>$('confirm-sheet').classList.add('hidden'));
$('confirm-auto').addEventListener('click',()=>{$('confirm-sheet').classList.add('hidden');sendCommand('atem.auto');});
start();
