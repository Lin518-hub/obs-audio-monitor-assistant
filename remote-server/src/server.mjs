import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as createHttpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createUpdateCache, parseUpdateReleaseBases } from './update-cache.mjs';
import {
  createWeComNotifier,
  DEFAULT_WECOM_NOTIFICATION_SETTINGS,
  normalizeWeComNotificationSettings
} from './wecom-notifier.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = resolve(here, '../public');
const port = Number(process.env.PORT || 8088);
const dataDir = resolve(process.env.DATA_DIR || '/data');
const updateDir = resolve(process.env.UPDATE_DIR || '/updates');
const dataFile = join(dataDir, 'remote-state.json');
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const complaintProxyUrl = new URL(String(process.env.COMPLAINT_PROXY_URL || 'http://complaint-tool:8010').replace(/\/$/, ''));
const complaintRoutePrefix = '/complaint';
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
  resume_monitoring: '恢复检测',
  rename_device: '修改直播间名称'
};
const COMMAND_TIMEOUT_MS = 20_000;
const emptyData = () => ({
  schemaVersion: MONITORING_IDENTITY_REVISION,
  devices: [],
  requests: [],
  approvals: [],
  commands: [],
  notificationSettings: { ...DEFAULT_WECOM_NOTIFICATION_SETTINGS },
  notificationSettingsUpdatedAt: null
});
let data = await loadData();
weComNotifier.updateSettings(data.notificationSettings);
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
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      notificationSettings: normalizeWeComNotificationSettings(parsed.notificationSettings),
      notificationSettingsUpdatedAt: Number.isFinite(Number(parsed.notificationSettingsUpdatedAt))
        ? Number(parsed.notificationSettingsUpdatedAt)
        : null
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
  const meterAgeMs = typeof audio.meterAgeMs === 'number' && Number.isFinite(audio.meterAgeMs)
    ? audio.meterAgeMs
    : Number.NaN;
  const hasFreshMeter = typeof rawLevel === 'number'
    && Number.isFinite(rawLevel)
    && (Number.isFinite(meterAgeMs)
      ? meterAgeMs >= 0 && meterAgeMs <= 5000
      : audio.ready === true);

  audio.levelDb = hasFreshMeter ? Math.max(-100, Math.min(12, rawLevel)) : null;
  audio.meterAgeMs = Number.isFinite(meterAgeMs) ? Math.max(0, Math.min(60_000, meterAgeMs)) : null;
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
  const mobileAccessEnabled = device.mobileAccessEnabled === true;
  return {
    uuid: device.uuid,
    label: device.label,
    roomName: device.roomName || '',
    roomNameRevision: wholeNumber(device.roomNameRevision),
    roomNameUpdatedAt: device.roomNameUpdatedAt || null,
    online: desktopSockets.has(device.uuid),
    onlineMobileClients: mobileSockets.get(device.uuid)?.size || 0,
    mobileAccessEnabled,
    weComNotificationsEnabled: device.weComNotificationsEnabled !== false,
    appVersion: appVersion(device.appVersion),
    platform: cleanText(device.platform, 20) || null,
    arch: cleanText(device.arch, 20) || null,
    osRelease: cleanText(device.osRelease, 80) || null,
    lastSeenAt: device.lastSeenAt || null,
    createdAt: device.createdAt,
    pairUrl: mobileAccessEnabled ? `${publicBaseUrl}/pair/${device.pairToken}` : null
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

const AUDIO_ALERT_SECONDS = 120;
const CAMERA_ALERT_SECONDS = 10 * 60;

function reminderProgress(elapsedSeconds, limitSeconds) {
  const ratio = Math.max(0, Number(elapsedSeconds) || 0) / Math.max(1, limitSeconds);
  return {
    warning: ratio <= 0.25 ? 0 : Math.min(1, (ratio - 0.25) / 0.65),
    danger: ratio <= 0.9 ? 0 : Math.min(1, (ratio - 0.9) / 0.1)
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
  const reportedAvailableVersion = appVersion(appState.updateAvailableVersion);
  const reportedDownloadedVersion = appVersion(appState.updateDownloadedVersion);
  const isNewerThanInstalled = (candidate) => Boolean(
    installedVersion
    && candidate
    && compareVersions(installedVersion, candidate) < 0
  );
  const updateAvailableVersion = isNewerThanInstalled(reportedAvailableVersion)
    ? reportedAvailableVersion
    : isNewerThanInstalled(latestVersion)
      ? latestVersion
      : null;
  const updateDownloadedVersion = isNewerThanInstalled(reportedDownloadedVersion)
    ? reportedDownloadedVersion
    : null;
  const updateAvailable = Boolean(updateAvailableVersion || updateDownloadedVersion);
  const live = obs.liveActive === true || obs.streaming === true || obs.recording === true || obs.simulatedLive === true || obs.virtualCameraActive === true;
  const audioSilentForSeconds = wholeNumber(audio.silentForSeconds);
  const audioProgress = reminderProgress(audioSilentForSeconds, AUDIO_ALERT_SECONDS);
  const audioTone = !online
    ? 'offline'
    : live && audio.ready === true && audioSilentForSeconds >= AUDIO_ALERT_SECONDS
      ? 'danger'
      : live && audio.ready === true && audioProgress.warning > 0
        ? 'warning'
        : live && audio.ready !== true
          ? 'warning'
          : audio.ready === true
            ? 'safe'
            : 'idle';
  const elapsedSeconds = wholeNumber(atem.elapsedSeconds);
  const limitSeconds = CAMERA_ALERT_SECONDS;
  const cameraExempt = atem.exempt === true;
  const cameraProgress = reminderProgress(elapsedSeconds, limitSeconds);
  const cameraTone = !online || !live || atem.connected !== true
    ? 'idle'
    : cameraExempt
      ? 'safe'
      : elapsedSeconds >= limitSeconds
      ? 'danger'
      : cameraProgress.warning > 0
        ? 'warning'
        : 'safe';

  return {
    uuid: device.uuid,
    label: device.label,
    roomName: device.roomName || '未命名直播间',
    roomNameRevision: wholeNumber(device.roomNameRevision),
    roomNameUpdatedAt: device.roomNameUpdatedAt || null,
    weComNotificationsEnabled: device.weComNotificationsEnabled !== false,
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
      silentForSeconds: audioSilentForSeconds,
      silenceDurationSeconds: AUDIO_ALERT_SECONDS,
      warningProgress: audioProgress.warning,
      dangerProgress: audioProgress.danger,
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
      overLimit: live && !cameraExempt && elapsedSeconds >= limitSeconds,
      exempt: cameraExempt,
      warningProgress: !live || cameraExempt ? 0 : cameraProgress.warning,
      dangerProgress: !live || cameraExempt ? 0 : cameraProgress.danger
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
      mobileAccessEnabled: device.mobileAccessEnabled === true,
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
      onlineMobileClients: room.devices.reduce((count, device) => count + device.onlineMobileClients, 0),
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
      onlineMobileClients: Array.from(mobileSockets.values()).reduce((count, sockets) => count + sockets.size, 0)
    },
    notifications: notificationStatus(),
    updates: publicUpdateCacheStatus(),
    access: {
      pendingRequests: data.requests.filter((item) => item.status === 'pending').length,
      activeApprovals: data.approvals.filter((item) => !item.revokedAt).length
    },
    commands: {
      available: Object.entries(REMOTE_ADMIN_COMMAND_LABELS).map(([id, label]) => ({ id, label })),
      recent: data.commands.slice(-50).reverse().map(publicCommand)
    },
    rooms
  };
}

function notificationStatus() {
  return {
    ...weComNotifier.getStatus(),
    settingsUpdatedAt: data.notificationSettingsUpdatedAt
  };
}

function parseNotificationSettings(body) {
  const source = body && typeof body === 'object' ? body : {};
  const audioAlertSeconds = Number(source.audioAlertSeconds);
  const cameraAlertSeconds = Number(source.cameraAlertSeconds);
  if (!Number.isFinite(audioAlertSeconds) || audioAlertSeconds < 30 || audioAlertSeconds > 1800) {
    throw new RangeError('音频推送时间必须在 30–1800 秒之间');
  }
  if (!Number.isFinite(cameraAlertSeconds) || cameraAlertSeconds < 60 || cameraAlertSeconds > 3600) {
    throw new RangeError('机位推送时间必须在 1–60 分钟之间');
  }
  return normalizeWeComNotificationSettings({
    enabled: source.enabled,
    audioEnabled: source.audioEnabled,
    cameraEnabled: source.cameraEnabled,
    recoveryEnabled: source.recoveryEnabled,
    audioAlertSeconds,
    cameraAlertSeconds
  });
}

async function persistNotificationSettings(settings) {
  const previousSettings = data.notificationSettings;
  const previousUpdatedAt = data.notificationSettingsUpdatedAt;
  data.notificationSettings = normalizeWeComNotificationSettings(settings);
  data.notificationSettingsUpdatedAt = now();
  try {
    await saveData();
  } catch (error) {
    data.notificationSettings = previousSettings;
    data.notificationSettingsUpdatedAt = previousUpdatedAt;
    throw error;
  }
  weComNotifier.updateSettings(data.notificationSettings);
  return notificationStatus();
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
    const roomNameRevision = wholeNumber(body.roomNameRevision);
    const mobileAccessEnabled = body.mobileAccessEnabled === true;
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
        roomNameRevision: Math.max(1, roomNameRevision),
        roomNameUpdatedAt: now(),
        mobileAccessEnabled,
        weComNotificationsEnabled: true,
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
      const storedRoomNameRevision = wholeNumber(device.roomNameRevision);
      if (roomNameRevision > storedRoomNameRevision) {
        device.roomName = roomName;
        device.roomNameRevision = roomNameRevision;
        device.roomNameUpdatedAt = now();
      } else {
        device.roomNameRevision = storedRoomNameRevision;
      }
      device.mobileAccessEnabled = mobileAccessEnabled;
      device.weComNotificationsEnabled = device.weComNotificationsEnabled !== false;
      device.monitoringIdentityRevision = MONITORING_IDENTITY_REVISION;
      device.appVersion = appVersion(body.appVersion, device.appVersion) || '';
      device.platform = cleanText(body.platform, 20) || device.platform || '';
      device.arch = cleanText(body.arch, 20) || device.arch || '';
      device.osRelease = cleanText(body.osRelease, 80) || device.osRelease || '';
      device.lastSeenAt = now();
    }

    const canonicalRoomName = cleanText(device.roomName, 60);
    const duplicateUuids = new Set(data.devices
      .filter((item) => item.uuid !== device.uuid && cleanText(item.roomName, 60).toLocaleLowerCase('zh-CN') === canonicalRoomName.toLocaleLowerCase('zh-CN'))
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
    if (!mobileAccessEnabled) closeMobileAccessForDevice(device.uuid, 4003, 'mobile_access_disabled');
    await saveData();
    return json(res, 200, { ok: true, device: publicDevice(device) });
  }

  if (req.method === 'GET' && url.pathname === '/api/pair/info') {
    const device = deviceByPairToken(url.searchParams.get('token') || '');
    if (!device) return json(res, 404, { error: 'pair_link_invalid' });
    if (device.mobileAccessEnabled !== true) return json(res, 403, { error: 'mobile_access_disabled' });
    return json(res, 200, { device: publicDevice(device) });
  }

  if (req.method === 'POST' && url.pathname === '/api/pair/request') {
    if (!allowRequest(req, 'pair', 12, 10 * 60_000)) return json(res, 429, { error: 'too_many_requests' });
    const body = await readJson(req);
    const device = deviceByPairToken(body.pairToken || '');
    if (!device) return json(res, 400, { error: 'invalid_request' });
    if (device.mobileAccessEnabled !== true) return json(res, 403, { error: 'mobile_access_disabled' });
    const clientId = cleanUuid(body.clientId);
    const roomName = cleanText(device.roomName, 60) || cleanText(body.roomName, 60);
    if (!clientId || roomName.length < 2) return json(res, 400, { error: 'invalid_request' });
    const recent = data.requests.find((item) => item.deviceUuid === device.uuid && item.clientId === clientId && item.status === 'pending');
    if (recent) return json(res, 200, { request: publicRequest(recent) });
    const request = {
      id: token(12),
      deviceUuid: device.uuid,
      clientId,
      clientName: cleanText(body.clientName, 60) || '移动浏览器',
      roomName,
      status: 'pending',
      createdAt: now()
    };
    data.requests.push(request);
    await saveData();
    notifyAdmins();
    return json(res, 201, { request: publicRequest(request) });
  }

  const requestMatch = url.pathname.match(/^\/api\/pair\/request\/([^/]+)$/);
  if (req.method === 'GET' && requestMatch) {
    const request = data.requests.find((item) => item.id === requestMatch[1] && item.clientId === url.searchParams.get('clientId'));
    if (!request) return json(res, 404, { error: 'request_not_found' });
    const payload = { request: publicRequest(request) };
    if (request.status === 'approved' && request.approvedToken) payload.accessToken = request.approvedToken;
    return json(res, 200, payload);
  }

  if (req.method === 'GET' && url.pathname === '/api/mobile/session') {
    const approval = approvalByToken(url.searchParams.get('token') || '');
    if (!approval) return json(res, 403, { error: 'access_denied' });
    const device = data.devices.find((item) => item.uuid === approval.deviceUuid);
    if (!device) return json(res, 404, { error: 'device_not_found' });
    if (device.mobileAccessEnabled !== true) return json(res, 403, { error: 'mobile_access_disabled' });
    approval.lastUsedAt = now();
    void saveData();
    return json(res, 200, {
      approval: publicApproval(approval),
      device: publicDevice(device),
      state: device.lastState ? normalizeDesktopState(device.lastState) : null
    });
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
        notifications: notificationStatus()
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
    if (req.method === 'GET' && url.pathname === '/api/monitor/notification-settings') {
      return json(res, 200, notificationStatus());
    }
    if (req.method === 'PUT' && url.pathname === '/api/monitor/notification-settings') {
      if (!allowRequest(req, 'monitor-notification-settings', 20, 60_000)) {
        return json(res, 429, { error: 'too_many_requests', message: '通知设置修改过于频繁，请稍后再试' });
      }
      try {
        const settings = parseNotificationSettings(await readJson(req, 16 * 1024));
        return json(res, 200, await persistNotificationSettings(settings));
      } catch (error) {
        if (error instanceof RangeError) {
          return json(res, 400, { error: 'invalid_notification_settings', message: error.message });
        }
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/monitor/notification-settings/reset') {
      if (!allowRequest(req, 'monitor-notification-settings-reset', 10, 60_000)) {
        return json(res, 429, { error: 'too_many_requests', message: '恢复默认操作过于频繁，请稍后再试' });
      }
      return json(res, 200, await persistNotificationSettings(DEFAULT_WECOM_NOTIFICATION_SETTINGS));
    }
    const renameMatch = url.pathname.match(/^\/api\/monitor\/devices\/([^/]+)\/name$/);
    if (req.method === 'PATCH' && renameMatch) {
      if (!allowRequest(req, 'monitor-rename-device', 30, 60_000)) {
        return json(res, 429, { error: 'too_many_requests', message: '名称修改过于频繁，请稍后再试' });
      }
      const deviceUuid = cleanUuid(renameMatch[1]);
      const device = data.devices.find((item) => item.uuid === deviceUuid);
      if (!device) return json(res, 404, { error: 'device_not_found', message: '未找到该直播间电脑' });
      const body = await readJson(req, 16 * 1024);
      const roomName = cleanText(body.roomName, 60);
      if (roomName.length < 2) {
        return json(res, 400, { error: 'room_name_required', message: '直播间名称至少需要 2 个字符' });
      }
      const duplicate = data.devices.find((item) => (
        item.uuid !== device.uuid
        && cleanText(item.roomName, 60).toLocaleLowerCase('zh-CN') === roomName.toLocaleLowerCase('zh-CN')
      ));
      if (duplicate) {
        return json(res, 409, { error: 'room_name_in_use', message: '这个直播间名称已被另一台电脑使用' });
      }

      const previousRoomName = cleanText(device.roomName, 60) || '未命名直播间';
      if (previousRoomName !== roomName) {
        device.roomName = roomName;
        device.roomNameRevision = Math.max(1, wholeNumber(device.roomNameRevision) + 1);
        device.roomNameUpdatedAt = now();
        data.commands.push({
          id: token(12),
          deviceUuid,
          command: 'rename_device',
          status: 'success',
          requestedAt: now(),
          completedAt: now(),
          message: `${previousRoomName} → ${roomName}`
        });
        await saveData();
      }

      const socket = desktopSockets.get(deviceUuid);
      const synced = socket?.readyState === WebSocket.OPEN;
      if (synced) {
        socket.send(JSON.stringify({
          type: 'device-config',
          roomName: device.roomName,
          roomNameRevision: wholeNumber(device.roomNameRevision)
        }));
      }
      return json(res, 200, { ok: true, device: monitorDevice(device), synced });
    }
    const weComTestMatch = url.pathname.match(/^\/api\/monitor\/devices\/([^/]+)\/wecom-test$/);
    if (req.method === 'POST' && weComTestMatch) {
      if (!allowRequest(req, 'monitor-wecom-test', 12, 10 * 60_000)) {
        return json(res, 429, { error: 'too_many_requests', message: '测试过于频繁，请稍后再试' });
      }
      const deviceUuid = cleanUuid(weComTestMatch[1]);
      const device = data.devices.find((item) => item.uuid === deviceUuid);
      if (!device) return json(res, 404, { error: 'device_not_found', message: '未找到该直播间电脑' });
      try {
        const result = await weComNotifier.sendStatusTest(device, normalizeDesktopState(device.lastState));
        return json(res, 200, { ok: true, message: `${device.roomName || '当前直播间'}状态已发送到企业微信`, sentAt: result.sentAt });
      } catch (error) {
        return json(res, 503, { error: 'wecom_test_failed', message: error instanceof Error ? error.message : String(error) });
      }
    }
    const weComPreferenceMatch = url.pathname.match(/^\/api\/monitor\/devices\/([^/]+)\/wecom-notifications$/);
    if (req.method === 'PATCH' && weComPreferenceMatch) {
      const deviceUuid = cleanUuid(weComPreferenceMatch[1]);
      const device = data.devices.find((item) => item.uuid === deviceUuid);
      if (!device) return json(res, 404, { error: 'device_not_found', message: '未找到该直播间电脑' });
      const body = await readJson(req, 16 * 1024);
      if (typeof body.enabled !== 'boolean') {
        return json(res, 400, { error: 'invalid_notification_preference', message: '请提供有效的通知开关' });
      }
      device.weComNotificationsEnabled = body.enabled;
      if (!body.enabled) weComNotifier.forgetDevice(deviceUuid);
      await saveData();
      return json(res, 200, { ok: true, device: monitorDevice(device) });
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

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function forwardedHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
  }
  const remoteAddress = req.socket.remoteAddress || '';
  const existingForwardedFor = String(req.headers['x-forwarded-for'] || '').trim();
  headers.host = complaintProxyUrl.host;
  headers['x-forwarded-for'] = [existingForwardedFor, remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  headers['x-forwarded-prefix'] = complaintRoutePrefix;
  return headers;
}

function forwardedResponseHeaders(sourceHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(sourceHeaders)) {
    if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
  }

  const location = sourceHeaders.location;
  if (typeof location === 'string' && location.startsWith('/') && !location.startsWith(`${complaintRoutePrefix}/`)) {
    headers.location = `${complaintRoutePrefix}${location}`;
  }

  if (Array.isArray(sourceHeaders['set-cookie'])) {
    headers['set-cookie'] = sourceHeaders['set-cookie'].map((cookie) =>
      cookie.replace(/;\s*Path=\/(;|$)/i, `; Path=${complaintRoutePrefix}$1`)
    );
  }
  return headers;
}

function proxyComplaint(req, res, url) {
  const upstreamPath = url.pathname.slice(complaintRoutePrefix.length) || '/';
  const path = `${upstreamPath}${url.search}`;

  return new Promise((resolve) => {
    const upstream = createHttpRequest({
      protocol: complaintProxyUrl.protocol,
      hostname: complaintProxyUrl.hostname,
      port: complaintProxyUrl.port || 80,
      method: req.method,
      path,
      headers: forwardedHeaders(req)
    }, (upstreamResponse) => {
      res.writeHead(
        upstreamResponse.statusCode || 502,
        forwardedResponseHeaders(upstreamResponse.headers)
      );
      upstreamResponse.pipe(res);
      upstreamResponse.once('end', resolve);
      upstreamResponse.once('error', (error) => {
        console.error('Complaint proxy response failed:', error);
        res.destroy(error);
        resolve();
      });
    });

    upstream.setTimeout(60_000, () => upstream.destroy(new Error('complaint_proxy_timeout')));
    upstream.once('error', (error) => {
      console.error('Complaint proxy request failed:', error);
      if (!res.headersSent) json(res, 502, { error: 'complaint_service_unavailable' });
      else res.destroy(error);
      resolve();
    });
    req.once('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
}

const requestListener = async (req, res) => {
  try {
    const url = new URL(req.url || '/', publicBaseUrl);
    if (url.pathname === complaintRoutePrefix || url.pathname.startsWith(`${complaintRoutePrefix}/`)) {
      return await proxyComplaint(req, res, url);
    }
    if (url.pathname === '/health') return json(res, 200, {
      ok: true,
      desktops: desktopSockets.size,
      mobiles: Array.from(mobileSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0),
      updates: updateCache.getStatus(),
      notifications: notificationStatus()
    });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/') return redirect(res, '/monitor');
    if (url.pathname === '/admin/' || url.pathname === '/admin') return redirect(res, '/monitor');
    if (url.pathname === '/monitor/') return redirect(res, '/monitor');
    if (url.pathname === '/monitor') return serveFile(req, res, join(publicDir, 'monitor.html'));
    if (url.pathname === '/remote' || url.pathname.startsWith('/pair/')) return serveFile(req, res, join(publicDir, 'mobile.html'));
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
  if (!['/ws/desktop', '/ws/mobile'].includes(url.pathname)) return socket.destroy();
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
      roomName: device.roomName,
      roomNameRevision: wholeNumber(device.roomNameRevision),
      pairUrl: device.mobileAccessEnabled === true ? `${publicBaseUrl}/pair/${device.pairToken}` : null,
      onlineMobileClients: mobileSockets.get(uuid)?.size || 0
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
          if (typeof appState.mobileAccessEnabled === 'boolean') {
            device.mobileAccessEnabled = appState.mobileAccessEnabled;
          }
          device.lastSeenAt = now();
          weComNotifier.observeDevice(device, device.lastState);
          if (device.mobileAccessEnabled === true) {
            broadcastMobile(uuid, { type: 'state', state: device.lastState });
          } else {
            closeMobileAccessForDevice(uuid, 4003, 'mobile_access_disabled');
          }
          socket.send(JSON.stringify({ type: 'state-ack', receivedAt: now() }));
        } else if (message.type === 'latency-ping' && Number.isFinite(Number(message.sentAt))) {
          socket.send(JSON.stringify({ type: 'latency-pong', sentAt: Number(message.sentAt) }));
        } else if (message.type === 'meter' && message.meter && typeof message.meter === 'object') {
          if (device.mobileAccessEnabled !== true) return;
          const rawLevelDb = message.meter.levelDb;
          const levelDb = typeof rawLevelDb === 'number' && Number.isFinite(rawLevelDb)
            ? Math.max(-100, Math.min(12, rawLevelDb))
            : null;
          broadcastMobile(uuid, {
            type: 'meter',
            meter: {
              timestamp: Number.isFinite(Number(message.meter.timestamp)) ? Number(message.meter.timestamp) : now(),
              activeInputName: cleanText(message.meter.activeInputName, 100),
              levelDb
            }
          });
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
  if (device.mobileAccessEnabled !== true) return socket.close(4003, 'mobile_access_disabled');
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
