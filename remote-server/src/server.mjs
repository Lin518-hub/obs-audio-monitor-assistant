import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createUpdateCache, parseUpdateReleaseBases } from './update-cache.mjs';
import { createWeComNotifier } from './wecom-notifier.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(here, '../public');
const port = Number(process.env.PORT || 8088);
const dataDir = resolve(process.env.DATA_DIR || '/data');
const updateDir = resolve(process.env.UPDATE_DIR || '/updates');
const dataFile = join(dataDir, 'remote-state.json');
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const tlsCertFile = process.env.TLS_CERT_FILE ? resolve(process.env.TLS_CERT_FILE) : '';
const tlsKeyFile = process.env.TLS_KEY_FILE ? resolve(process.env.TLS_KEY_FILE) : '';
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
const updateSyncEnabled = !/^(0|false|off)$/i.test(String(process.env.UPDATE_SYNC_ENABLED || 'true'));
const updateSyncIntervalMs = Math.max(60_000, Number(process.env.UPDATE_SYNC_INTERVAL_MS || 2 * 60 * 1000));
const updateSyncToken = String(process.env.UPDATE_SYNC_TOKEN || '');
const updateGithubToken = String(process.env.UPDATE_GITHUB_TOKEN || '');
const weComWebhookUrl = String(process.env.WECOM_WEBHOOK_URL || '');
const weComNotifyEnabled = !/^(0|false|off)$/i.test(String(process.env.WECOM_NOTIFY_ENABLED || 'true'));
const MONITORING_IDENTITY_REVISION = 1;
if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');

await mkdir(dataDir, { recursive: true });
await mkdir(updateDir, { recursive: true });

const updateCache = createUpdateCache({
  updateDir,
  enabled: updateSyncEnabled,
  intervalMs: updateSyncIntervalMs,
  releaseBases: parseUpdateReleaseBases(process.env.UPDATE_RELEASE_BASE_URLS),
  githubToken: updateGithubToken
});
await updateCache.initialize();
const weComNotifier = createWeComNotifier({
  webhookUrl: weComWebhookUrl,
  enabled: weComNotifyEnabled
});

const REMOTE_ADMIN_COMMANDS = new Set([
  'show_app',
  'reconnect_obs',
  'reconnect_atem',
  'check_update',
  'pause_monitoring',
  'resume_monitoring'
]);
const REMOTE_ADMIN_COMMAND_LABELS = {
  show_app: '打开检测助手',
  reconnect_obs: '重连 OBS',
  reconnect_atem: '重连 ATEM',
  check_update: '检查更新',
  pause_monitoring: '暂停检测',
  resume_monitoring: '恢复检测'
};
const COMMAND_TIMEOUT_MS = 20_000;
const emptyData = () => ({ schemaVersion: MONITORING_IDENTITY_REVISION, devices: [], requests: [], approvals: [], commands: [] });
let data = await loadData();
const desktopSockets = new Map();
const mobileSockets = new Map();
const pendingAdminCommands = new Map();
const adminSessions = new Map();
const loginAttempts = new Map();
const requestLimits = new Map();
let saveQueue = Promise.resolve();

if (data.schemaVersion < MONITORING_IDENTITY_REVISION) {
  data = emptyData();
  await saveData();
}

async function loadData() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return {
      schemaVersion: Number.isFinite(Number(parsed.schemaVersion)) ? Number(parsed.schemaVersion) : 0,
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands : []
    };
  } catch {
    return emptyData();
  }
}

function saveData() {
  pruneStoredData();
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const operation = saveQueue.catch(() => undefined).then(async () => {
    const temporary = `${dataFile}.tmp-${process.pid}-${token(4)}`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, dataFile);
  });
  saveQueue = operation;
  return operation;
}

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};
function now() {
  return Date.now();
}
const cleanText = (value, max = 80) => String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);
const cleanUuid = (value) => /^[0-9a-f-]{20,64}$/i.test(String(value || '')) ? String(value) : '';

function normalizeDesktopState(value) {
  const state = value && typeof value === 'object' ? { ...value } : {};
  const audio = state.audio && typeof state.audio === 'object' ? { ...state.audio } : {};
  const rawLevel = audio.levelDb;
  const lastMeterAt = Number(audio.lastMeterReceivedAt);
  const hasFreshMeter = typeof rawLevel === 'number'
    && Number.isFinite(rawLevel)
    && Number.isFinite(lastMeterAt)
    && now() - lastMeterAt <= 5000;

  audio.levelDb = hasFreshMeter ? Math.max(-100, Math.min(12, rawLevel)) : null;
  if (!hasFreshMeter) {
    audio.ready = false;
    audio.phase = 'idle';
    audio.tone = '';
    audio.silentForSeconds = 0;
    audio.display = '等待音频数据';
    audio.hint = Number.isFinite(lastMeterAt) && lastMeterAt > 0 ? '音频电平链路已中断' : '尚未收到 OBS 电平数据';
  } else if (audio.ready !== true && audio.display === '正在讲话') {
    const obs = state.obs && typeof state.obs === 'object' ? state.obs : {};
    audio.display = obs.streaming || obs.recording ? '等待检测' : '等待直播/录制';
    audio.hint = obs.streaming || obs.recording ? '电脑端检测尚未就绪' : '开始直播、录制或模拟开播后检测';
  }
  if (hasFreshMeter && !['idle', 'speaking', 'silent', 'alert'].includes(audio.phase)) {
    audio.phase = audio.ready !== true
      ? 'idle'
      : audio.tone === 'danger'
        ? 'alert'
        : audio.display === '正在讲话'
          ? 'speaking'
          : 'silent';
  }
  state.audio = audio;
  return state;
}

function pruneStoredData() {
  const current = now();
  const pendingCutoff = current - 24 * 60 * 60 * 1000;
  const approvedTokenCutoff = current - 24 * 60 * 60 * 1000;
  for (const request of data.requests) {
    if (request.status === 'pending' && request.createdAt < pendingCutoff) {
      request.status = 'rejected';
      request.decidedAt = current;
    }
    // The mobile access token is returned only while the approved browser is
    // completing its first exchange. Long-term authentication stores only the
    // hash in approvals, so plaintext tokens do not accumulate in state data.
    if (request.approvedToken && (request.decidedAt || request.createdAt) < approvedTokenCutoff) {
      delete request.approvedToken;
    }
  }
  data.requests = data.requests.slice(-2000);
  data.approvals = data.approvals
    .filter((approval) => !approval.revokedAt || approval.revokedAt > current - 30 * 24 * 60 * 60 * 1000)
    .slice(-2000);
  data.commands = data.commands
    .filter((command) => (command.requestedAt || 0) > current - 30 * 24 * 60 * 60 * 1000)
    .slice(-500);
}

function allowRequest(req, scope, max, windowMs) {
  const key = `${scope}:${req.socket.remoteAddress || 'unknown'}`;
  const current = now();
  const bucket = requestLimits.get(key);
  if (!bucket || bucket.resetAt <= current) {
    requestLimits.set(key, { count: 1, resetAt: current + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; frame-ancestors 'none'");
}

function json(res, status, payload) {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  securityHeaders(res);
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

function adminSession(req) {
  const session = adminSessions.get(cookies(req).obs_remote_admin);
  if (!session || session.expiresAt < now()) return null;
  session.expiresAt = now() + 8 * 60 * 60 * 1000;
  return session;
}

function deviceByPairToken(pairToken) {
  return data.devices.find((device) => safeEqual(device.pairToken, pairToken));
}

function approvalByToken(accessToken) {
  const hash = sha256(accessToken);
  return data.approvals.find((approval) => approval.tokenHash === hash && !approval.revokedAt);
}

function publicDevice(device) {
  return {
    uuid: device.uuid,
    label: device.label,
    roomName: device.roomName || '',
    online: desktopSockets.has(device.uuid),
    onlineMobileClients: 0,
    mobileAccessEnabled: false,
    appVersion: appVersion(device.appVersion),
    platform: cleanText(device.platform, 20) || null,
    arch: cleanText(device.arch, 20) || null,
    osRelease: cleanText(device.osRelease, 80) || null,
    lastSeenAt: device.lastSeenAt || null,
    createdAt: device.createdAt,
    pairUrl: null
  };
}

function publicRequest(request) {
  const device = data.devices.find((item) => item.uuid === request.deviceUuid);
  return {
    id: request.id,
    deviceUuid: request.deviceUuid,
    clientId: request.clientId,
    deviceLabel: device?.label || request.deviceUuid,
    roomName: request.roomName,
    clientName: request.clientName,
    status: request.status,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt || null
  };
}

function publicApproval(approval) {
  const device = data.devices.find((item) => item.uuid === approval.deviceUuid);
  return {
    id: approval.id,
    deviceUuid: approval.deviceUuid,
    clientId: approval.clientId,
    deviceLabel: device?.label || approval.deviceUuid,
    roomName: approval.roomName,
    clientName: approval.clientName,
    createdAt: approval.createdAt,
    lastUsedAt: approval.lastUsedAt || null
  };
}

function monitorDevice(device) {
  const online = desktopSockets.has(device.uuid);
  const state = device.lastState ? normalizeDesktopState(device.lastState) : null;
  const audio = state?.audio && typeof state.audio === 'object' ? state.audio : {};
  const atem = state?.atem && typeof state.atem === 'object' ? state.atem : {};
  const obs = state?.obs && typeof state.obs === 'object' ? state.obs : {};
  const service = state?.service && typeof state.service === 'object' ? state.service : {};
  const appState = state?.app && typeof state.app === 'object' ? state.app : {};
  const latestVersion = cleanText(updateCache.getStatus().version, 32) || null;
  const installedVersion = appVersion(
    appState.version,
    appState.updateCurrentVersion,
    device.appVersion
  );
  const updateStatus = cleanText(appState.updateStatus, 32) || 'unknown';
  const updateAvailableVersion = cleanText(appState.updateAvailableVersion, 32) || null;
  const updateDownloadedVersion = cleanText(appState.updateDownloadedVersion, 32) || null;
  const updateAvailable = Boolean(
    updateAvailableVersion
    || updateDownloadedVersion
    || (installedVersion && latestVersion && compareVersions(installedVersion, latestVersion) < 0)
  );
  const live = obs.liveActive === true || obs.streaming === true || obs.recording === true || obs.simulatedLive === true || obs.virtualCameraActive === true;
  const audioTone = !online
    ? 'offline'
    : audio.phase === 'alert' || audio.tone === 'danger'
      ? 'danger'
      : audio.tone === 'warning'
        ? 'warning'
        : live && audio.ready !== true
          ? 'warning'
          : audio.ready === true
            ? 'safe'
            : 'idle';
  const elapsedSeconds = wholeNumber(atem.elapsedSeconds);
  const limitSeconds = wholeNumber(atem.limitSeconds);
  const cameraTone = !online || atem.connected !== true
    ? 'idle'
    : atem.overLimit === true
      ? 'danger'
      : limitSeconds > 0 && elapsedSeconds >= limitSeconds * 0.9
        ? 'warning'
        : 'safe';

  return {
    uuid: device.uuid,
    label: device.label,
    roomName: device.roomName || '未命名直播间',
    online,
    onlineMobileClients: mobileSockets.get(device.uuid)?.size || 0,
    lastSeenAt: device.lastSeenAt || null,
    stateUpdatedAt: finiteNumber(state?.timestamp),
    overallTone: strongestTone(audioTone, cameraTone, online ? 'safe' : 'offline'),
    audio: {
      tone: audioTone,
      ready: audio.ready === true,
      phase: cleanText(audio.phase, 20) || 'idle',
      inputName: cleanText(audio.inputName, 100) || '未选择音源',
      levelDb: finiteNumber(audio.levelDb),
      thresholdDb: finiteNumber(audio.thresholdDb),
      silentForSeconds: wholeNumber(audio.silentForSeconds),
      silenceDurationSeconds: wholeNumber(audio.silenceDurationSeconds),
      display: cleanText(audio.display, 80) || '等待音频数据',
      hint: cleanText(audio.hint, 160),
      lastMeterReceivedAt: finiteNumber(audio.lastMeterReceivedAt)
    },
    atem: {
      tone: cameraTone,
      connected: atem.connected === true,
      programInput: wholeNumber(atem.programInput),
      previewInput: wholeNumber(atem.previewInput),
      programName: cleanText(atem.inputLabels?.[atem.programInput], 100) || '',
      previewName: cleanText(atem.inputLabels?.[atem.previewInput], 100) || '',
      elapsedSeconds,
      limitSeconds,
      overLimit: atem.overLimit === true
    },
    obs: {
      connected: obs.connected === true,
      streaming: obs.streaming === true,
      recording: obs.recording === true,
      simulatedLive: obs.simulatedLive === true,
      virtualCameraActive: obs.virtualCameraActive === true,
      liveActive: live,
      fps: finiteNumber(obs.fps),
      cpu: finiteNumber(obs.cpu),
      bitrateKbps: finiteNumber(obs.bitrateKbps)
    },
    app: {
      version: installedVersion,
      platform: cleanText(appState.platform, 20) || cleanText(device.platform, 20) || null,
      arch: cleanText(appState.arch, 20) || cleanText(device.arch, 20) || null,
      osRelease: cleanText(appState.osRelease, 80) || cleanText(device.osRelease, 80) || null,
      paused: appState.paused === true,
      autoUpdateEnabled: appState.autoUpdateEnabled !== false,
      mobileAccessEnabled: false,
      updateStatus,
      updateAvailable,
      updateAvailableVersion,
      updateDownloadedVersion,
      updateSourceLabel: cleanText(appState.updateSourceLabel, 100) || null,
      updateLastCheckedAt: finiteNumber(appState.updateLastCheckedAt),
      updateMessage: cleanText(appState.updateMessage, 180) || null
    },
    service: {
      routeType: cleanText(service.routeType, 20) || null,
      latencyMs: finiteNumber(service.latencyMs),
      lastSyncAt: finiteNumber(service.lastSyncAt)
    }
  };
}

function monitorOverview() {
  const grouped = new Map();
  const monitoringDevices = data.devices.filter((device) => device.monitoringIdentityRevision === MONITORING_IDENTITY_REVISION);
  for (const device of monitoringDevices) {
    const item = monitorDevice(device);
    const room = grouped.get(item.roomName) || { name: item.roomName, devices: [] };
    room.devices.push(item);
    grouped.set(item.roomName, room);
  }

  const rooms = Array.from(grouped.values()).map((room) => {
    room.devices.sort((left, right) => Number(right.online) - Number(left.online) || String(left.label).localeCompare(String(right.label), 'zh-CN'));
    const tone = room.devices.reduce((current, device) => strongestTone(current, device.overallTone), 'offline');
    return {
      name: room.name,
      tone,
      totalDevices: room.devices.length,
      onlineDevices: room.devices.filter((device) => device.online).length,
      activeLiveDevices: room.devices.filter((device) => device.obs.liveActive).length,
      alertCount: room.devices.reduce((count, device) => count + Number(device.audio.tone === 'danger') + Number(device.atem.tone === 'danger'), 0),
      warningCount: room.devices.reduce((count, device) => count + Number(device.audio.tone === 'warning') + Number(device.atem.tone === 'warning'), 0),
      onlineMobileClients: 0,
      updateAvailableDevices: room.devices.filter((device) => device.app.updateAvailable).length,
      devices: room.devices
    };
  }).sort((left, right) => toneRank(right.tone) - toneRank(left.tone) || left.name.localeCompare(right.name, 'zh-CN'));

  return {
    generatedAt: now(),
    summary: {
      totalRooms: rooms.length,
      onlineRooms: rooms.filter((room) => room.onlineDevices > 0).length,
      totalDevices: monitoringDevices.length,
      onlineDevices: monitoringDevices.filter((device) => desktopSockets.has(device.uuid)).length,
      activeLiveDevices: rooms.reduce((count, room) => count + room.activeLiveDevices, 0),
      alertCount: rooms.reduce((count, room) => count + room.alertCount, 0),
      warningCount: rooms.reduce((count, room) => count + room.warningCount, 0),
      updateAvailableDevices: rooms.reduce((count, room) => count + room.updateAvailableDevices, 0),
      onlineMobileClients: 0
    },
    notifications: weComNotifier.getStatus(),
    updates: publicUpdateCacheStatus(),
    commands: {
      available: Object.entries(REMOTE_ADMIN_COMMAND_LABELS).map(([id, label]) => ({ id, label })),
      recent: data.commands.slice(-50).reverse().map(publicCommand)
    },
    rooms
  };
}

function publicCommand(command) {
  const device = data.devices.find((item) => item.uuid === command.deviceUuid);
  return {
    id: command.id,
    deviceUuid: command.deviceUuid,
    deviceLabel: device?.label || command.deviceUuid,
    roomName: device?.roomName || '未命名直播间',
    command: command.command,
    label: REMOTE_ADMIN_COMMAND_LABELS[command.command] || command.command,
    status: command.status,
    requestedAt: command.requestedAt,
    completedAt: command.completedAt || null,
    message: cleanText(command.message, 200) || ''
  };
}

function publicUpdateCacheStatus() {
  const status = updateCache.getStatus();
  return {
    status: status.status,
    version: status.version,
    source: status.source,
    lastAttemptAt: status.lastAttemptAt,
    lastSuccessAt: status.lastSuccessAt,
    error: status.error
  };
}

function appVersion(...values) {
  for (const value of values) {
    const normalized = cleanText(value, 32).replace(/^v/i, '');
    if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) return normalized;
  }
  return null;
}

function compareVersions(left, right) {
  const normalize = (value) => String(value || '').replace(/^v/i, '').split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) < (b[index] || 0) ? -1 : 1;
  }
  return 0;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function wholeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function toneRank(tone) {
  return { offline: 0, idle: 1, safe: 2, warning: 3, danger: 4 }[tone] || 0;
}

function strongestTone(...tones) {
  return tones.reduce((strongest, tone) => toneRank(tone) > toneRank(strongest) ? tone : strongest, 'offline');
}

function broadcastMobile(deviceUuid, payload) {
  const encoded = JSON.stringify(payload);
  for (const socket of mobileSockets.get(deviceUuid) || []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
  }
}

function notifyDesktopPresence(deviceUuid) {
  const desktop = desktopSockets.get(deviceUuid);
  if (desktop?.readyState === WebSocket.OPEN) {
    desktop.send(JSON.stringify({ type: 'presence', onlineMobileClients: mobileSockets.get(deviceUuid)?.size || 0 }));
  }
}

function closeMobileAccessForDevice(deviceUuid, code, reason) {
  for (const socket of mobileSockets.get(deviceUuid) || []) {
    socket.close(code, reason);
  }
}

function dispatchAdminCommand(deviceUuid, command) {
  const socket = desktopSockets.get(deviceUuid);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ status: 'failed', message: '目标电脑当前离线' });
  }
  const record = {
    id: token(12),
    deviceUuid,
    command,
    status: 'pending',
    requestedAt: now(),
    completedAt: null,
    message: ''
  };
  data.commands.push(record);
  void saveData();
  return new Promise((resolveCommand) => {
    const timer = setTimeout(() => {
      pendingAdminCommands.delete(record.id);
      record.status = 'timeout';
      record.completedAt = now();
      record.message = '电脑端响应超时';
      void saveData();
      resolveCommand({ status: record.status, message: record.message, record: publicCommand(record) });
    }, COMMAND_TIMEOUT_MS);
    pendingAdminCommands.set(record.id, {
      deviceUuid,
      resolve(result) {
        clearTimeout(timer);
        pendingAdminCommands.delete(record.id);
        record.status = result.ok ? 'success' : 'failed';
        record.completedAt = now();
        record.message = cleanText(result.message, 200) || (result.ok ? '操作完成' : '操作失败');
        void saveData();
        resolveCommand({ status: record.status, message: record.message, record: publicCommand(record) });
      }
    });
    socket.send(JSON.stringify({ type: 'admin-command', id: record.id, command }));
  });
}

function failPendingCommandsForDevice(deviceUuid, message) {
  for (const [id, pending] of pendingAdminCommands) {
    if (pending.deviceUuid !== deviceUuid) continue;
    pending.resolve({ ok: false, message });
    pendingAdminCommands.delete(id);
  }
}

function notifyAdmins() {
  // Admin UI polls; this hook keeps future websocket support localized.
}

async function serveFile(req, res, file, cache = false) {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not_file');
    const mime = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.yml': 'text/yaml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
      '.mp4': 'video/mp4', '.zip': 'application/zip', '.exe': 'application/vnd.microsoft.portable-executable', '.blockmap': 'application/octet-stream'
    }[extname(file).toLowerCase()] || 'application/octet-stream';
    securityHeaders(res);
    const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': cache ? 'public, max-age=300' : 'no-store' };
    const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const requestedEnd = range[2] ? Number(range[2]) : info.size - 1;
      const end = Math.min(requestedEnd, info.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/updates/status') {
    return json(res, 200, updateCache.getStatus());
  }

  if (req.method === 'POST' && url.pathname === '/api/updates/sync') {
    const authorization = String(req.headers.authorization || '');
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!updateSyncToken || !safeEqual(suppliedToken, updateSyncToken)) return json(res, 403, { error: 'update_sync_forbidden' });
    try {
      return json(res, 200, await updateCache.sync());
    } catch (error) {
      return json(res, 502, { error: error.message, status: updateCache.getStatus() });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/devices/register') {
    if (!allowRequest(req, 'register', 60, 60_000)) return json(res, 429, { error: 'too_many_requests' });
    const body = await readJson(req);
    const uuid = cleanUuid(body.uuid);
    const secret = String(body.secret || '');
    if (!uuid || secret.length < 32) return json(res, 400, { error: 'invalid_device_credentials' });
    if (Number(body.monitoringIdentityRevision) !== MONITORING_IDENTITY_REVISION) {
      return json(res, 426, { error: 'client_upgrade_required' });
    }
    const roomName = cleanText(body.roomName, 60);
    if (roomName.length < 2) return json(res, 400, { error: 'room_name_required' });
    let device = data.devices.find((item) => item.uuid === uuid);
    if (device && !safeEqual(device.secretHash, sha256(secret))) return json(res, 403, { error: 'device_auth_failed' });
    if (!device) {
      device = {
        uuid,
        secretHash: sha256(secret),
        pairToken: token(24),
        label: cleanText(body.label, 80) || `电脑 ${uuid.slice(0, 8)}`,
        roomName,
        mobileAccessEnabled: false,
        monitoringIdentityRevision: MONITORING_IDENTITY_REVISION,
        appVersion: appVersion(body.appVersion) || '',
        platform: cleanText(body.platform, 20),
        arch: cleanText(body.arch, 20),
        osRelease: cleanText(body.osRelease, 80),
        createdAt: now(),
        lastSeenAt: now(),
        lastState: null
      };
      data.devices.push(device);
    } else {
      device.label = cleanText(body.label, 80) || device.label;
      device.roomName = roomName;
      device.mobileAccessEnabled = false;
      device.monitoringIdentityRevision = MONITORING_IDENTITY_REVISION;
      device.appVersion = appVersion(body.appVersion, device.appVersion) || '';
      device.platform = cleanText(body.platform, 20) || device.platform || '';
      device.arch = cleanText(body.arch, 20) || device.arch || '';
      device.osRelease = cleanText(body.osRelease, 80) || device.osRelease || '';
      device.lastSeenAt = now();
    }

    const duplicateUuids = new Set(data.devices
      .filter((item) => item.uuid !== device.uuid && cleanText(item.roomName, 60).toLocaleLowerCase('zh-CN') === roomName.toLocaleLowerCase('zh-CN'))
      .map((item) => item.uuid));
    for (const duplicateUuid of duplicateUuids) {
      desktopSockets.get(duplicateUuid)?.close(4000, 'room_reassigned');
      closeMobileAccessForDevice(duplicateUuid, 4003, 'mobile_access_removed');
    }
    if (duplicateUuids.size > 0) {
      data.devices = data.devices.filter((item) => !duplicateUuids.has(item.uuid));
      data.requests = data.requests.filter((item) => !duplicateUuids.has(item.deviceUuid));
      data.approvals = data.approvals.filter((item) => !duplicateUuids.has(item.deviceUuid));
    }
    closeMobileAccessForDevice(device.uuid, 4003, 'mobile_access_removed');
    await saveData();
    return json(res, 200, { ok: true, device: publicDevice(device) });
  }

  if (req.method === 'POST' && url.pathname === '/api/devices/wecom-test') {
    if (!allowRequest(req, 'wecom-test', 6, 10 * 60_000)) return json(res, 429, { error: 'too_many_requests', message: '测试过于频繁，请稍后再试' });
    const body = await readJson(req);
    const uuid = cleanUuid(body.uuid);
    const secret = String(body.secret || '');
    const device = data.devices.find((item) => item.uuid === uuid);
    if (!device || !safeEqual(device.secretHash, sha256(secret))) return json(res, 403, { error: 'device_auth_failed', message: '监控中心设备认证失败' });
    if (Number(body.monitoringIdentityRevision) !== MONITORING_IDENTITY_REVISION) {
      return json(res, 426, { error: 'client_upgrade_required', message: '请先升级检测助手' });
    }
    const state = normalizeDesktopState(body.state);
    device.lastState = state;
    device.appVersion = appVersion(state.app?.version, state.app?.updateCurrentVersion, device.appVersion) || '';
    device.lastSeenAt = now();
    try {
      const result = await weComNotifier.sendStatusTest(device, state);
      await saveData();
      return json(res, 200, { ok: true, message: '当前直播间状态已发送到企业微信', sentAt: result.sentAt });
    } catch (error) {
      return json(res, 503, { error: 'wecom_test_failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/pair/info') {
    return json(res, 410, { error: 'mobile_access_removed' });
  }

  if (req.method === 'POST' && url.pathname === '/api/pair/request') {
    return json(res, 410, { error: 'mobile_access_removed' });
  }

  const requestMatch = url.pathname.match(/^\/api\/pair\/request\/([^/]+)$/);
  if (req.method === 'GET' && requestMatch) {
    return json(res, 410, { error: 'mobile_access_removed' });
  }

  if (req.method === 'GET' && url.pathname === '/api/mobile/session') {
    return json(res, 410, { error: 'mobile_access_removed' });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, blockedUntil: 0, lastAt: 0 };
    if (attempt.blockedUntil > now()) return json(res, 429, { error: 'too_many_attempts' });
    const body = await readJson(req);
    if (!safeEqual(body.password || '', adminPassword)) {
      attempt.count += 1;
      attempt.lastAt = now();
      if (attempt.count >= 6) { attempt.blockedUntil = now() + 5 * 60 * 1000; attempt.count = 0; }
      loginAttempts.set(ip, attempt);
      return json(res, 401, { error: 'invalid_password' });
    }
    loginAttempts.delete(ip);
    const sessionId = token(32);
    adminSessions.set(sessionId, { expiresAt: now() + 8 * 60 * 60 * 1000 });
    securityHeaders(res);
    const secureCookie = req.socket.encrypted ? '; Secure' : '';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `obs_remote_admin=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`, 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!adminSession(req)) return json(res, 401, { error: 'admin_auth_required' });
    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
      return json(res, 200, {
        devices: data.devices.map(publicDevice),
        requests: data.requests.filter((item) => item.status === 'pending').map(publicRequest),
        approvals: data.approvals.filter((item) => !item.revokedAt).map(publicApproval),
        notifications: weComNotifier.getStatus()
      });
    }
    const decision = url.pathname.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|reject)$/);
    if (req.method === 'POST' && decision) {
      const request = data.requests.find((item) => item.id === decision[1] && item.status === 'pending');
      if (!request) return json(res, 404, { error: 'request_not_found' });
      request.status = decision[2] === 'approve' ? 'approved' : 'rejected';
      request.decidedAt = now();
      if (request.status === 'approved') {
        const accessToken = token(36);
        request.approvedToken = accessToken;
        for (const approval of data.approvals) {
          if (approval.deviceUuid === request.deviceUuid && approval.clientId === request.clientId && !approval.revokedAt) {
            approval.revokedAt = now();
            for (const socket of mobileSockets.get(approval.deviceUuid) || []) {
              if (socket.approvalId === approval.id) socket.close(4003, 'access_replaced');
            }
          }
        }
        data.approvals.push({ id: token(12), deviceUuid: request.deviceUuid, clientId: request.clientId, clientName: request.clientName, roomName: request.roomName, tokenHash: sha256(accessToken), createdAt: now(), lastUsedAt: null, revokedAt: null });
        const device = data.devices.find((item) => item.uuid === request.deviceUuid);
        if (device && !device.roomName) device.roomName = request.roomName;
      }
      await saveData();
      return json(res, 200, { request: publicRequest(request) });
    }
    const revoke = url.pathname.match(/^\/api\/admin\/approvals\/([^/]+)$/);
    if (req.method === 'DELETE' && revoke) {
      const approval = data.approvals.find((item) => item.id === revoke[1] && !item.revokedAt);
      if (!approval) return json(res, 404, { error: 'approval_not_found' });
      approval.revokedAt = now();
      await saveData();
      for (const socket of mobileSockets.get(approval.deviceUuid) || []) {
        if (socket.approvalId === approval.id) socket.close(4003, 'access_revoked');
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/updates') {
      const files = await Promise.all((await readdir(updateDir)).map(async (name) => {
        const info = await stat(join(updateDir, name));
        return info.isFile() && !name.startsWith('.') ? { name, size: info.size, updatedAt: info.mtimeMs } : null;
      }));
      return json(res, 200, { files: files.filter(Boolean), sync: updateCache.getStatus() });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/updates/sync') {
      try {
        return json(res, 200, { sync: await updateCache.sync() });
      } catch (error) {
        return json(res, 502, { error: error.message, sync: updateCache.getStatus() });
      }
    }
    const updateMatch = url.pathname.match(/^\/api\/admin\/updates\/([^/]+)$/);
    if (updateMatch) {
      const filename = basename(decodeURIComponent(updateMatch[1])).replace(/[^A-Za-z0-9._-]/g, '_');
      const target = join(updateDir, filename);
      if (req.method === 'DELETE') {
        await rm(target, { force: true });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        const temporary = `${target}.upload-${token(5)}`;
        let size = 0;
        const output = createWriteStream(temporary, { mode: 0o644 });
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 1024 * 1024 * 1024) throw new Error('file_too_large');
            if (!output.write(chunk)) await new Promise((resolveDrain) => output.once('drain', resolveDrain));
          }
          await new Promise((resolveEnd, rejectEnd) => {
            output.once('error', rejectEnd);
            output.end(resolveEnd);
          });
          await rename(temporary, target);
          return json(res, 200, { ok: true, name: filename, size });
        } catch (error) {
          output.destroy();
          await rm(temporary, { force: true });
          return json(res, 400, { error: error.message });
        }
      }
    }
  }

  if (url.pathname.startsWith('/api/monitor/')) {
    if (!adminSession(req)) return json(res, 401, { error: 'admin_auth_required' });
    if (req.method === 'GET' && url.pathname === '/api/monitor/overview') {
      return json(res, 200, monitorOverview());
    }
    const commandMatch = url.pathname.match(/^\/api\/monitor\/devices\/([^/]+)\/commands$/);
    if (req.method === 'POST' && commandMatch) {
      if (!allowRequest(req, 'monitor-command', 30, 60_000)) return json(res, 429, { error: 'too_many_requests' });
      const deviceUuid = cleanUuid(commandMatch[1]);
      const device = data.devices.find((item) => item.uuid === deviceUuid);
      if (!device) return json(res, 404, { error: 'device_not_found' });
      const body = await readJson(req, 16 * 1024);
      const command = cleanText(body.command, 40);
      if (!REMOTE_ADMIN_COMMANDS.has(command)) return json(res, 400, { error: 'unsupported_command' });
      if (command === 'pause_monitoring' && body.confirmed !== true) {
        return json(res, 409, { error: 'confirmation_required' });
      }
      const result = await dispatchAdminCommand(deviceUuid, command);
      return json(res, result.status === 'success' ? 200 : result.status === 'timeout' ? 504 : 409, result);
    }
  }

  return json(res, 404, { error: 'not_found' });
}

const requestListener = async (req, res) => {
  try {
    const url = new URL(req.url || '/', publicBaseUrl);
    if (url.pathname === '/health') return json(res, 200, {
      ok: true,
      desktops: desktopSockets.size,
      mobiles: Array.from(mobileSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0),
      updates: updateCache.getStatus(),
      notifications: weComNotifier.getStatus()
    });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/') return redirect(res, '/admin');
    if (url.pathname === '/admin/') return redirect(res, '/admin');
    if (url.pathname === '/monitor/') return redirect(res, '/monitor');
    if (url.pathname === '/admin') return serveFile(req, res, join(publicDir, 'admin.html'));
    if (url.pathname === '/monitor') return serveFile(req, res, join(publicDir, 'monitor.html'));
    if (url.pathname === '/remote' || url.pathname.startsWith('/pair/')) return redirect(res, '/monitor');
    if (url.pathname.startsWith('/assets/')) {
      const file = resolve(publicDir, `.${url.pathname}`);
      if (!file.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });
      return serveFile(req, res, file, true);
    }
    if (url.pathname.startsWith('/updates/')) {
      const file = resolve(updateDir, `.${url.pathname.slice('/updates'.length)}`);
      if (!file.startsWith(updateDir)) return json(res, 403, { error: 'forbidden' });
      return serveFile(req, res, file, true);
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    if (error instanceof SyntaxError) return json(res, 400, { error: 'invalid_json' });
    if (error?.message === 'request_too_large') return json(res, 413, { error: 'request_too_large' });
    return json(res, 500, { error: 'internal_error' });
  }
};

if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
  throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
}

const httpServer = createHttpServer(requestListener);
const httpsServer = tlsCertFile
  ? createHttpsServer({
      cert: await readFile(tlsCertFile),
      key: await readFile(tlsKeyFile)
    }, requestListener)
  : null;
const server = httpsServer
  ? createNetServer((socket) => {
      socket.setTimeout(10_000, () => socket.destroy());
      socket.once('data', (buffer) => {
        socket.setTimeout(0);
        socket.pause();
        socket.unshift(buffer);
        // TLS ClientHello records start with 0x16. Plain HTTP is delegated to
        // the existing server so installed LAN clients keep working on 8088.
        const protocolServer = buffer[0] === 0x16 ? httpsServer : httpServer;
        protocolServer.emit('connection', socket);
        if (protocolServer === httpServer) socket.resume();
      });
    })
  : httpServer;

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
const handleUpgrade = (req, socket, head) => {
  const url = new URL(req.url || '/', publicBaseUrl);
  if (url.pathname !== '/ws/desktop') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url));
};
httpServer.on('upgrade', handleUpgrade);
httpsServer?.on('upgrade', handleUpgrade);

wss.on('connection', (socket, req, url) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  if (url.pathname === '/ws/desktop') {
    const uuid = cleanUuid(url.searchParams.get('uuid'));
    const secret = url.searchParams.get('secret') || '';
    const device = data.devices.find((item) => item.uuid === uuid && safeEqual(item.secretHash, sha256(secret)));
    if (!device) return socket.close(4001, 'device_auth_failed');
    desktopSockets.get(uuid)?.close(4000, 'replaced');
    desktopSockets.set(uuid, socket);
    device.lastSeenAt = now();
    void saveData();
    socket.send(JSON.stringify({
      type: 'registered',
      onlineMobileClients: 0
    }));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'state' && message.state && typeof message.state === 'object') {
          device.lastState = normalizeDesktopState(message.state);
          const appState = device.lastState.app && typeof device.lastState.app === 'object' ? device.lastState.app : {};
          device.appVersion = appVersion(appState.version, appState.updateCurrentVersion, device.appVersion) || '';
          device.platform = cleanText(appState.platform, 20) || device.platform || '';
          device.arch = cleanText(appState.arch, 20) || device.arch || '';
          device.osRelease = cleanText(appState.osRelease, 80) || device.osRelease || '';
          device.mobileAccessEnabled = false;
          device.lastSeenAt = now();
          weComNotifier.observeDevice(device, device.lastState);
          socket.send(JSON.stringify({ type: 'state-ack', receivedAt: now() }));
        } else if (message.type === 'latency-ping' && Number.isFinite(Number(message.sentAt))) {
          socket.send(JSON.stringify({ type: 'latency-pong', sentAt: Number(message.sentAt) }));
        } else if (message.type === 'meter') {
          // Central monitoring uses the throttled state snapshot; the former
          // high-frequency meter stream was only needed by mobile clients.
        } else if (message.type === 'admin-command-result') {
          const id = cleanText(message.id, 80);
          const pending = pendingAdminCommands.get(id);
          if (pending?.deviceUuid === uuid) {
            pending.resolve({
              ok: message.ok === true,
              message: cleanText(message.message, 200) || (message.ok === true ? '操作完成' : '操作失败')
            });
          }
        }
      } catch { /* ignore malformed desktop message */ }
    });
    socket.on('close', () => {
      if (desktopSockets.get(uuid) === socket) desktopSockets.delete(uuid);
      failPendingCommandsForDevice(uuid, '电脑连接已断开');
      broadcastMobile(uuid, { type: 'device-status', online: false });
    });
    broadcastMobile(uuid, { type: 'device-status', online: true });
    return;
  }

  const approval = approvalByToken(url.searchParams.get('token') || '');
  if (!approval) return socket.close(4003, 'access_denied');
  const device = data.devices.find((item) => item.uuid === approval.deviceUuid);
  if (!device) return socket.close(4004, 'device_not_found');
  if (device.mobileAccessEnabled === false) return socket.close(4003, 'mobile_access_disabled');
  const sockets = mobileSockets.get(device.uuid) || new Set();
  socket.approvalId = approval.id;
  sockets.add(socket);
  mobileSockets.set(device.uuid, sockets);
  notifyDesktopPresence(device.uuid);
  approval.lastUsedAt = now();
  socket.send(JSON.stringify({ type: 'state', state: device.lastState ? normalizeDesktopState(device.lastState) : null }));
  socket.send(JSON.stringify({ type: 'device-status', online: desktopSockets.has(device.uuid) }));
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'command') return;
      const clientCommandId = cleanText(message.id, 80);
      socket.send(JSON.stringify({
        type: 'command-result',
        id: clientCommandId,
        ok: false,
        message: '手机远程当前仅支持监看'
      }));
    } catch { /* ignore malformed mobile message */ }
  });
  socket.on('close', () => {
    sockets.delete(socket);
    if (sockets.size === 0) mobileSockets.delete(device.uuid);
    notifyDesktopPresence(device.uuid);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
  const current = now();
  for (const [id, session] of adminSessions) if (session.expiresAt < current) adminSessions.delete(id);
  for (const [key, bucket] of requestLimits) if (bucket.resetAt < current) requestLimits.delete(key);
  for (const [key, attempt] of loginAttempts) {
    if (attempt.blockedUntil < current && current - (attempt.lastAt || 0) > 60 * 60 * 1000) loginAttempts.delete(key);
  }
}, 30_000);
heartbeat.unref();

for (const protocolServer of [httpServer, httpsServer].filter(Boolean)) {
  protocolServer.headersTimeout = 15_000;
  protocolServer.keepAliveTimeout = 5_000;
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down remote service`);
  clearInterval(heartbeat);
  updateCache.stop();
  await weComNotifier.stop();
  for (const socket of wss.clients) socket.terminate();

  await Promise.race([
    saveQueue.catch((error) => console.error('Failed to finish state save during shutdown', error)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
  ]);
  await Promise.race([
    new Promise((resolveClose) => server.close(resolveClose)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
  ]);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

server.listen(port, '0.0.0.0', () => {
  console.log(`OBS remote server listening on ${publicBaseUrl}`);
});
