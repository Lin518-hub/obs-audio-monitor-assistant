const $ = (id) => document.getElementById(id);
let overview = null;
let refreshTimer = null;
let refreshPromise = null;
let activeFilter = 'all';
let searchText = '';
let selectedDeviceUuid = null;
let pendingConfirmedAction = null;

const api = async (path, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22_000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.message || '请求失败');
      error.payload = body;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('服务器响应超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const toast = (message) => {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 3000);
};

function showDashboard() {
  $('monitor-login').classList.add('hidden');
  $('monitor-dashboard').classList.remove('hidden');
}

function showLogin() {
  closeDrawer();
  $('monitor-dashboard').classList.add('hidden');
  $('monitor-login').classList.remove('hidden');
}

async function login() {
  $('monitor-login-error').textContent = '';
  try {
    await api('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('monitor-password').value })
    });
    showDashboard();
    await refresh();
  } catch (error) {
    $('monitor-login-error').textContent = error.message === 'invalid_password' ? '管理员密码错误' : error.message;
  }
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  clearTimeout(refreshTimer);
  refreshPromise = (async () => {
    try {
      overview = await api('/api/monitor/overview');
      showDashboard();
      render();
    } catch (error) {
      if (error.message === 'admin_auth_required') {
        showLogin();
        return;
      }
      $('monitor-service-chip').className = 'state-pill danger';
      $('monitor-service-chip').textContent = '同步失败';
      toast(error.message);
    } finally {
      refreshPromise = null;
      scheduleRefresh();
    }
  })();
  return refreshPromise;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, document.hidden ? 15_000 : 3_000);
}

function render() {
  const { summary, rooms, generatedAt, notifications, updates, commands } = overview;
  $('monitor-updated-at').textContent = `更新于 ${relativeTime(generatedAt)}`;
  $('monitor-service-chip').className = 'state-pill';
  $('monitor-service-chip').textContent = summary.onlineDevices > 0 ? `${summary.onlineDevices} 台电脑在线` : '暂无电脑在线';
  const notifyFailed = Boolean(notifications?.enabled && notifications?.lastError);
  $('monitor-notify-chip').className = `state-pill ${notifyFailed ? 'danger' : notifications?.enabled ? '' : 'offline'}`;
  $('monitor-notify-chip').textContent = notifyFailed
    ? '企业微信发送异常'
    : notifications?.enabled
      ? '企业微信通知已启用'
      : notifications?.configured
        ? '企业微信通知已停用'
        : '企业微信通知未配置';
  renderSummary(summary, updates);
  renderRooms(rooms);
  renderCommandLog(commands?.recent || []);
  if (selectedDeviceUuid) {
    const selected = findDevice(selectedDeviceUuid);
    if (selected) renderDrawer(selected);
    else closeDrawer();
  }
}

function renderSummary(summary, updates) {
  const items = [
    ['在线直播间', `${summary.onlineRooms} / ${summary.totalRooms}`, summary.onlineRooms > 0 ? 'safe' : 'idle'],
    ['电脑在线', `${summary.onlineDevices} / ${summary.totalDevices}`, summary.onlineDevices > 0 ? 'safe' : 'idle'],
    ['直播中', String(summary.activeLiveDevices), summary.activeLiveDevices > 0 ? 'safe' : 'idle'],
    ['当前异常', String(summary.alertCount), summary.alertCount > 0 ? 'danger' : 'safe'],
    ['当前预警', String(summary.warningCount), summary.warningCount > 0 ? 'warning' : 'safe'],
    ['待更新电脑', String(summary.updateAvailableDevices || 0), summary.updateAvailableDevices > 0 ? 'warning' : 'safe']
  ];
  const root = $('monitor-summary');
  root.replaceChildren(...items.map(([label, value, tone]) => {
    const item = document.createElement('article');
    item.className = `monitor-summary-item tone-${tone}`;
    const copy = document.createElement('span');
    copy.textContent = label;
    const numberNode = document.createElement('strong');
    numberNode.textContent = value;
    item.append(copy, numberNode);
    return item;
  }));
  const cacheMessage = updates?.status === 'ready'
    ? `内部更新缓存 v${updates.version || '--'} 已就绪`
    : updates?.status === 'syncing'
      ? '内部更新缓存正在同步'
      : updates?.error
        ? `内部更新缓存异常：${updates.error}`
        : '内部更新缓存尚未就绪';
  root.dataset.wecom = cacheMessage;
}

function renderRooms(rooms) {
  const root = $('monitor-rooms');
  root.replaceChildren();
  const visibleRooms = rooms
    .map((room) => ({ ...room, devices: room.devices.filter(deviceMatches) }))
    .filter((room) => room.devices.length > 0);
  if (!visibleRooms.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state monitor-empty';
    empty.textContent = rooms.length
      ? '没有符合当前搜索或筛选条件的电脑。'
      : '暂无已注册直播电脑。安装并填写直播间名称后会自动出现在这里。';
    root.append(empty);
    return;
  }
  for (const room of visibleRooms) root.append(roomView(room));
}

function deviceMatches(device) {
  const haystack = [
    device.roomName,
    device.label,
    device.audio.inputName,
    device.audio.display,
    device.atem.programName,
    device.atem.previewName,
    device.app.version,
    device.app.platform
  ].filter(Boolean).join(' ').toLowerCase();
  if (searchText && !haystack.includes(searchText)) return false;
  if (activeFilter === 'alert') return ['danger', 'warning'].includes(device.overallTone);
  if (activeFilter === 'live') return device.obs.liveActive;
  if (activeFilter === 'offline') return !device.online;
  if (activeFilter === 'update') return device.app.updateAvailable;
  return true;
}

function roomView(room) {
  const section = document.createElement('section');
  section.className = `monitor-room tone-${room.tone}`;

  const header = document.createElement('header');
  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = room.name;
  const visibleOnline = room.devices.filter((device) => device.online).length;
  const visibleLive = room.devices.filter((device) => device.obs.liveActive).length;
  const subtitle = document.createElement('p');
  subtitle.textContent = `${visibleOnline}/${room.devices.length} 台电脑在线 · ${visibleLive} 台直播中`;
  titleWrap.append(title, subtitle);
  const chips = document.createElement('div');
  chips.className = 'monitor-room-chips';
  const alertCount = room.devices.filter((device) => device.overallTone === 'danger').length;
  const warningCount = room.devices.filter((device) => device.overallTone === 'warning').length;
  if (alertCount > 0) chips.append(chip(`${alertCount} 台报警`, 'danger'));
  if (warningCount > 0) chips.append(chip(`${warningCount} 台预警`, 'warning'));
  if (alertCount === 0 && warningCount === 0) chips.append(chip(visibleOnline > 0 ? '状态正常' : '全部离线', visibleOnline > 0 ? 'safe' : 'offline'));
  header.append(titleWrap, chips);

  const columnHeader = document.createElement('div');
  columnHeader.className = 'monitor-device-columns';
  for (const value of ['电脑', 'OBS', '音频', '当前机位', '版本']) {
    const node = document.createElement('span');
    node.textContent = value;
    columnHeader.append(node);
  }

  const devices = document.createElement('div');
  devices.className = 'monitor-device-list';
  for (const device of room.devices) devices.append(deviceView(device));
  section.append(header, columnHeader, devices);
  return section;
}

function deviceView(device) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `monitor-device tone-${device.overallTone}`;
  row.addEventListener('click', () => openDrawer(device.uuid));

  const identity = document.createElement('div');
  identity.className = 'monitor-device-identity';
  const name = document.createElement('strong');
  name.textContent = device.label;
  const sync = document.createElement('span');
  sync.textContent = device.online
    ? `${routeLabel(device.service.routeType)} · ${device.service.latencyMs == null ? '延迟 --' : `${Math.round(device.service.latencyMs)} ms`} · ${relativeTime(device.service.lastSyncAt || device.stateUpdatedAt)}`
    : `离线 · ${relativeTime(device.lastSeenAt)}`;
  identity.append(statusDot(device.online ? device.overallTone : 'offline'), name, sync);

  const obs = metricBlock(
    obsDisplay(device.obs),
    device.obs.connected
      ? `${numberText(device.obs.fps, 1, '--')} FPS · CPU ${numberText(device.obs.cpu, 1, '--')}%`
      : '等待连接',
    device.obs.connected ? 'safe' : 'idle'
  );

  const audioValue = device.audio.levelDb == null ? '-- dB' : `${device.audio.levelDb.toFixed(1)} dB`;
  const audio = metricBlock(device.audio.display, `${device.audio.inputName} · ${audioValue}`, device.audio.tone);
  audio.append(levelBar(device.audio.levelDb, device.audio.thresholdDb));

  const cameraName = device.atem.programName || (device.atem.programInput ? `PGM ${device.atem.programInput}` : '未读取机位');
  const camera = metricBlock(
    device.atem.connected ? cameraName : 'ATEM 未连接',
    device.atem.connected ? `${formatDuration(device.atem.elapsedSeconds)} · PVW ${device.atem.previewName || device.atem.previewInput || '--'}` : '等待导播台',
    device.atem.tone
  );

  const version = metricBlock(
    device.app.version ? `v${device.app.version}` : '版本未知',
    device.app.updateAvailable
      ? `可更新至 v${device.app.updateAvailableVersion || device.app.updateDownloadedVersion || overview.updates?.version || '--'}`
      : platformLabel(device.app),
    device.app.updateAvailable ? 'warning' : device.online ? 'safe' : 'idle'
  );

  row.append(identity, obs, audio, camera, version);
  return row;
}

function metricBlock(value, detail, tone) {
  const block = document.createElement('div');
  block.className = `monitor-metric tone-${tone || 'idle'}`;
  const valueNode = document.createElement('strong');
  valueNode.textContent = value || '--';
  const detailNode = document.createElement('small');
  detailNode.textContent = detail || '--';
  block.append(valueNode, detailNode);
  return block;
}

function levelBar(levelDb, thresholdDb) {
  const track = document.createElement('div');
  track.className = 'monitor-level-track';
  const fill = document.createElement('i');
  const threshold = document.createElement('span');
  fill.style.transform = `scaleX(${levelRatio(levelDb)})`;
  threshold.style.left = `${levelRatio(thresholdDb) * 100}%`;
  track.append(fill, threshold);
  return track;
}

function openDrawer(uuid) {
  selectedDeviceUuid = uuid;
  const device = findDevice(uuid);
  if (!device) return;
  $('monitor-drawer-backdrop').classList.remove('hidden');
  $('monitor-device-drawer').classList.remove('hidden');
  requestAnimationFrame(() => {
    $('monitor-drawer-backdrop').classList.add('visible');
    $('monitor-device-drawer').classList.add('visible');
  });
  renderDrawer(device);
}

function closeDrawer() {
  selectedDeviceUuid = null;
  const backdrop = $('monitor-drawer-backdrop');
  const drawer = $('monitor-device-drawer');
  backdrop?.classList.remove('visible');
  drawer?.classList.remove('visible');
  setTimeout(() => {
    backdrop?.classList.add('hidden');
    drawer?.classList.add('hidden');
  }, 220);
}

function renderDrawer(device) {
  $('monitor-device-title').textContent = device.label;
  $('monitor-device-subtitle').textContent = `${device.roomName} · ${device.online ? '电脑在线' : `离线 ${relativeTime(device.lastSeenAt)}`}`;
  const detail = $('monitor-device-detail');
  detail.replaceChildren(
    detailSection('运行状态', [
      ['OBS', obsDisplay(device.obs)],
      ['音频', `${device.audio.display} · ${device.audio.levelDb == null ? '-- dB' : `${device.audio.levelDb.toFixed(1)} dB`}`],
      ['当前机位', device.atem.connected ? `${device.atem.programName || `PGM ${device.atem.programInput}`} · ${formatDuration(device.atem.elapsedSeconds)}` : 'ATEM 未连接'],
      ['检测状态', device.app.paused ? '已暂停' : '运行中']
    ]),
    detailSection('电脑与版本', [
      ['当前版本', device.app.version ? `v${device.app.version}` : '未知'],
      ['系统', platformLabel(device.app)],
      ['自动更新', device.app.autoUpdateEnabled ? '已开启' : '已关闭'],
      ['更新状态', updateDetail(device.app)],
      ['最近检查', relativeTime(device.app.updateLastCheckedAt)]
    ]),
    detailSection('远程服务', [
      ['线路', routeLabel(device.service.routeType)],
      ['延迟', device.service.latencyMs == null ? '--' : `${Math.round(device.service.latencyMs)} ms`],
      ['最后同步', relativeTime(device.service.lastSyncAt || device.stateUpdatedAt)],
      ['手机在线', `${device.onlineMobileClients} 台`],
      ['手机访问', device.app.mobileAccessEnabled ? '已允许' : '已关闭']
    ])
  );

  const actions = $('monitor-device-actions');
  actions.replaceChildren();
  const definitions = [
    ['show_app', '打开检测助手', false],
    ['reconnect_obs', '重连 OBS', false],
    ['reconnect_atem', '重连 ATEM', false],
    ['check_update', '检查更新', false],
    [device.app.paused ? 'resume_monitoring' : 'pause_monitoring', device.app.paused ? '恢复检测' : '暂停检测', !device.app.paused]
  ];
  for (const [command, label, needsConfirmation] of definitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = command === 'pause_monitoring' ? 'monitor-action warning' : command === 'resume_monitoring' ? 'monitor-action primary-action' : 'monitor-action';
    button.textContent = label;
    button.disabled = !device.online;
    button.addEventListener('click', () => {
      if (needsConfirmation) {
        showConfirmation(() => void runCommand(device.uuid, command, true));
      } else {
        void runCommand(device.uuid, command, false);
      }
    });
    actions.append(button);
  }
}

function detailSection(title, rows) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || '--';
    list.append(term, description);
  }
  section.append(heading, list);
  return section;
}

async function runCommand(deviceUuid, command, confirmed) {
  const actionButtons = [...$('monitor-device-actions').querySelectorAll('button')];
  actionButtons.forEach((button) => { button.disabled = true; });
  try {
    const result = await api(`/api/monitor/devices/${encodeURIComponent(deviceUuid)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, confirmed })
    });
    toast(result.message || '操作完成');
    await refresh();
  } catch (error) {
    toast(commandErrorText(error));
  } finally {
    const current = findDevice(deviceUuid);
    if (current) renderDrawer(current);
  }
}

function showConfirmation(action) {
  pendingConfirmedAction = action;
  $('monitor-confirm').classList.remove('hidden');
  requestAnimationFrame(() => $('monitor-confirm').classList.add('visible'));
}

function closeConfirmation() {
  pendingConfirmedAction = null;
  $('monitor-confirm').classList.remove('visible');
  setTimeout(() => $('monitor-confirm').classList.add('hidden'), 180);
}

function renderCommandLog(commands) {
  const root = $('monitor-command-log');
  root.replaceChildren();
  if (!commands.length) {
    const empty = document.createElement('p');
    empty.className = 'monitor-log-empty';
    empty.textContent = '暂无后台操作记录。';
    root.append(empty);
    return;
  }
  for (const command of commands.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = `monitor-log-row state-${command.status}`;
    const time = document.createElement('time');
    time.textContent = relativeTime(command.requestedAt);
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${command.roomName} · ${command.deviceLabel}`;
    const description = document.createElement('span');
    description.textContent = `${command.label} · ${command.message || statusLabel(command.status)}`;
    copy.append(title, description);
    const status = chip(statusLabel(command.status), command.status === 'success' ? 'safe' : command.status === 'pending' ? 'warning' : 'danger');
    row.append(time, copy, status);
    root.append(row);
  }
}

function findDevice(uuid) {
  for (const room of overview?.rooms || []) {
    const device = room.devices.find((item) => item.uuid === uuid);
    if (device) return device;
  }
  return null;
}

function chip(label, tone) {
  const node = document.createElement('span');
  node.className = `state-pill ${tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : tone === 'offline' ? 'offline' : ''}`;
  node.textContent = label;
  return node;
}

function statusDot(tone) {
  const dot = document.createElement('i');
  dot.className = `monitor-status-dot tone-${tone}`;
  return dot;
}

function levelRatio(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db + 90) / 85));
}

function numberText(value, digits, fallback) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : fallback;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function relativeTime(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '--';
  const delta = Date.now() - Number(value);
  if (delta < 0) return '刚刚';
  if (delta < 10_000) return '刚刚';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`;
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(Number(value)).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function obsDisplay(obs) {
  if (obs.streaming) return '直播中';
  if (obs.recording) return '录制中';
  if (obs.simulatedLive) return '模拟开播';
  if (obs.virtualCameraActive) return '虚拟摄像头';
  return obs.connected ? '已连接' : '未连接';
}

function routeLabel(route) {
  if (route === 'lan') return '局域网';
  if (route === 'public') return '公网 HTTPS';
  if (route === 'custom') return '自定义线路';
  return '线路未知';
}

function platformLabel(app) {
  const platform = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[app.platform] || app.platform || '系统未知';
  return [platform, app.arch, app.osRelease].filter(Boolean).join(' · ');
}

function updateDetail(app) {
  if (app.updateDownloadedVersion) return `v${app.updateDownloadedVersion} 已下载`;
  if (app.updateAvailableVersion) return `可更新至 v${app.updateAvailableVersion}`;
  if (app.updateStatus === 'checking') return '正在检查';
  if (app.updateStatus === 'downloading') return '正在下载';
  if (app.updateStatus === 'error') return app.updateMessage || '检查失败';
  return app.updateMessage || '当前为最新版本';
}

function statusLabel(status) {
  return {
    pending: '执行中',
    success: '成功',
    failed: '失败',
    timeout: '超时'
  }[status] || status;
}

function commandErrorText(error) {
  const map = {
    device_not_found: '找不到目标电脑',
    unsupported_command: '不支持这个操作',
    confirmation_required: '该操作需要确认',
    too_many_requests: '操作过于频繁，请稍后再试'
  };
  return error.payload?.message || map[error.message] || error.message;
}

$('monitor-login-button').addEventListener('click', () => void login());
$('monitor-password').addEventListener('keydown', (event) => { if (event.key === 'Enter') void login(); });
$('refresh-monitor').addEventListener('click', () => void refresh());
$('monitor-search-input').addEventListener('input', (event) => {
  searchText = event.currentTarget.value.trim().toLowerCase();
  if (overview) renderRooms(overview.rooms);
});
$('monitor-filter').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  activeFilter = button.dataset.filter;
  for (const item of $('monitor-filter').querySelectorAll('button')) item.classList.toggle('active', item === button);
  if (overview) renderRooms(overview.rooms);
});
$('monitor-device-close').addEventListener('click', closeDrawer);
$('monitor-drawer-backdrop').addEventListener('click', closeDrawer);
$('monitor-confirm-cancel').addEventListener('click', closeConfirmation);
$('monitor-confirm-accept').addEventListener('click', () => {
  const action = pendingConfirmedAction;
  closeConfirmation();
  action?.();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('monitor-confirm').classList.contains('hidden')) closeConfirmation();
    else closeDrawer();
  }
});
document.addEventListener('visibilitychange', scheduleRefresh);
void refresh();
