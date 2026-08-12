const $ = (id) => document.getElementById(id);
let overview = null;
let refreshTimer = null;
let refreshPromise = null;
let activeFilter = 'all';
let searchText = '';
let selectedDeviceUuid = null;
let pendingConfirmedAction = null;
let accessOverview = { requests: [], approvals: [] };

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
  closeManagementPanel('monitor-access-management');
  closeManagementPanel('monitor-update-management');
  if (!$('monitor-notification-settings').classList.contains('hidden')) closeNotificationSettings();
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
  const { summary, rooms, generatedAt, notifications, updates, access, commands } = overview;
  $('monitor-updated-at').textContent = `更新于 ${relativeTime(generatedAt)}`;
  $('monitor-service-chip').className = 'state-pill';
  $('monitor-service-chip').textContent = summary.onlineRooms > 0 ? `${summary.onlineRooms} 个直播间在线` : '暂无直播间在线';
  const notifyFailed = Boolean(notifications?.enabled && notifications?.lastError);
  $('monitor-notify-chip').className = `state-pill ${notifyFailed ? 'danger' : notifications?.enabled ? '' : 'offline'}`;
  $('monitor-notify-chip').textContent = notifyFailed
    ? '企业微信发送异常'
    : notifications?.enabled
      ? '企业微信通知已启用'
      : notifications?.configured
        ? '企业微信通知已停用'
        : '企业微信通知未配置';
  const notificationSettings = notifications?.settings;
  if (notificationSettings) {
    const audioSummary = notificationSettings.audioEnabled
      ? `音频 ${durationSettingText(notificationSettings.audioAlertSeconds)}`
      : '音频关闭';
    const cameraSummary = notificationSettings.cameraEnabled
      ? `机位 ${durationSettingText(notificationSettings.cameraAlertSeconds)}`
      : '机位关闭';
    $('monitor-notify-chip').title = `${audioSummary} · ${cameraSummary}`;
  }
  const pendingAccess = Number(access?.pendingRequests) || 0;
  $('monitor-access-badge').textContent = String(pendingAccess);
  $('monitor-access-badge').classList.toggle('hidden', pendingAccess === 0);
  $('monitor-access-button').classList.toggle('monitor-attention-button', pendingAccess > 0);
  $('monitor-access-button').title = pendingAccess > 0
    ? `${pendingAccess} 个手机访问申请待处理`
    : `${Number(access?.activeApprovals) || 0} 个已授权设备`;
  renderSummary(summary, updates);
  renderRooms(rooms);
  renderCommandLog(commands?.recent || []);
  if (selectedDeviceUuid) {
    const selected = findDevice(selectedDeviceUuid);
    if (!selected) closeDrawer();
    else if (!$('monitor-device-detail').contains(document.activeElement)) renderDrawer(selected);
  }
}

function renderSummary(summary, updates) {
  const items = [
    ['在线直播间', `${summary.onlineRooms} / ${summary.totalRooms}`, summary.onlineRooms > 0 ? 'safe' : 'idle'],
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
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `monitor-room-row tone-${room.tone}`;
  const device = room.devices[0];
  row.style.setProperty('--timer-warning-progress', String(Math.max(
    Number(device.audio?.warningProgress) || 0,
    Number(device.atem?.warningProgress) || 0
  )));
  row.style.setProperty('--timer-danger-progress', String(Math.max(
    Number(device.audio?.dangerProgress) || 0,
    Number(device.atem?.dangerProgress) || 0
  )));
  row.addEventListener('click', () => openDrawer(device.uuid));

  const identity = document.createElement('div');
  identity.className = 'monitor-room-identity';
  identity.append(statusDot(device.overallTone));
  const titleWrap = document.createElement('span');
  titleWrap.className = 'monitor-room-copy';
  const titleLine = document.createElement('span');
  titleLine.className = 'monitor-room-title';
  const title = document.createElement('h2');
  title.textContent = room.name;
  const roomState = device.overallTone === 'danger'
    ? chip('需要处理', 'danger')
    : device.overallTone === 'warning'
      ? chip('请留意', 'warning')
      : chip(device.online ? (device.obs.liveActive ? '直播中' : '状态正常') : '电脑离线', device.online ? 'safe' : 'offline');
  titleLine.append(title, roomState);
  const subtitle = document.createElement('p');
  subtitle.textContent = device.online
    ? `${device.label} · ${routeLabel(device.service.routeType)} · ${relativeTime(device.service.lastSyncAt || device.stateUpdatedAt)}`
    : `${device.label} · 离线 ${relativeTime(device.lastSeenAt)}`;
  titleWrap.append(titleLine, subtitle);
  identity.append(titleWrap);

  const obs = metricBlock(
    obsDisplay(device.obs),
    device.obs.connected
      ? `${numberText(device.obs.fps, 1, '--')} FPS · CPU ${numberText(device.obs.cpu, 1, '--')}%`
      : '等待连接',
    device.obs.connected ? 'safe' : 'idle'
  );

  const audioValue = device.audio.levelDb == null ? '-- dB' : `${device.audio.levelDb.toFixed(1)} dB`;
  const audio = metricBlock(
    device.audio.display,
    `${device.audio.inputName} · ${audioValue}`,
    device.audio.tone,
    device.audio.warningProgress,
    device.audio.dangerProgress
  );
  audio.append(levelBar(device.audio.levelDb, device.audio.thresholdDb));

  const cameraName = device.atem.programName || (device.atem.programInput ? `PGM ${device.atem.programInput}` : '未读取机位');
  const camera = metricBlock(
    device.atem.connected ? cameraName : 'ATEM 未连接',
    device.atem.connected
      ? device.atem.exempt
        ? `出镜机位 · 不计时 · PVW ${device.atem.previewName || device.atem.previewInput || '--'}`
        : `${formatDuration(device.atem.elapsedSeconds)} · PVW ${device.atem.previewName || device.atem.previewInput || '--'}`
      : '等待导播台',
    device.atem.tone,
    device.atem.warningProgress,
    device.atem.dangerProgress
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

function metricBlock(value, detail, tone, warningProgress = 0, dangerProgress = 0) {
  const block = document.createElement('div');
  block.className = `monitor-metric tone-${tone || 'idle'}`;
  block.style.setProperty('--timer-warning-progress', String(Number(warningProgress) || 0));
  block.style.setProperty('--timer-danger-progress', String(Number(dangerProgress) || 0));
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

function openManagementPanel(id) {
  const panel = $(id);
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('visible'));
}

function closeManagementPanel(id) {
  const panel = $(id);
  if (!panel || panel.classList.contains('hidden')) return;
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.add('hidden'), 200);
}

async function openAccessManagement() {
  openManagementPanel('monitor-access-management');
  renderManagementLoading('monitor-access-requests', '正在读取待审批申请…');
  renderManagementLoading('monitor-access-approvals', '正在读取已授权设备…');
  await refreshAccessManagement();
}

async function refreshAccessManagement() {
  try {
    accessOverview = await api('/api/admin/overview');
    renderAccessManagement();
  } catch (error) {
    if (error.message === 'admin_auth_required') return showLogin();
    renderManagementLoading('monitor-access-requests', '访问申请读取失败。');
    renderManagementLoading('monitor-access-approvals', '授权设备读取失败。');
    toast(error.message);
  }
}

function renderAccessManagement() {
  const requests = accessOverview.requests || [];
  const approvals = accessOverview.approvals || [];
  $('monitor-access-request-count').textContent = `${requests.length} 个`;
  $('monitor-access-request-count').className = `state-pill ${requests.length ? 'warning' : 'offline'}`;
  $('monitor-access-approval-count').textContent = `${approvals.length} 个`;
  $('monitor-access-approval-count').className = `state-pill ${approvals.length ? '' : 'offline'}`;
  renderManagementList(
    'monitor-access-requests',
    requests,
    (request) => managementItem(
      `${request.roomName || '未命名直播间'} · ${request.clientName || '未命名手机'}`,
      `${request.deviceLabel || request.deviceUuid} · 申请于 ${relativeTime(request.createdAt)}`,
      [
        managementAction('拒绝', 'danger-action', () => decideAccessRequest(request.id, 'reject')),
        managementAction('通过', 'primary-action', () => decideAccessRequest(request.id, 'approve'))
      ]
    ),
    '暂无待审批申请。请先在客户端开发者模式中开启手机监看，再扫码提交申请。'
  );
  renderManagementList(
    'monitor-access-approvals',
    approvals,
    (approval) => managementItem(
      `${approval.roomName || '未命名直播间'} · ${approval.clientName || '未命名手机'}`,
      `${approval.deviceLabel || approval.deviceUuid} · ${approval.lastUsedAt ? `最近访问 ${relativeTime(approval.lastUsedAt)}` : '尚未建立连接'}`,
      [managementAction('撤销授权', 'danger-action', () => revokeAccessApproval(approval.id))]
    ),
    '暂无已授权的手机或平板。'
  );
}

async function decideAccessRequest(requestId, decision) {
  try {
    await api(`/api/admin/requests/${encodeURIComponent(requestId)}/${decision}`, { method: 'POST' });
    toast(decision === 'approve' ? '已通过手机访问申请' : '已拒绝手机访问申请');
    await Promise.all([refreshAccessManagement(), refresh()]);
  } catch (error) {
    toast(error.message === 'request_not_found' ? '该申请已被处理' : error.message);
    await refreshAccessManagement();
  }
}

async function revokeAccessApproval(approvalId) {
  try {
    await api(`/api/admin/approvals/${encodeURIComponent(approvalId)}`, { method: 'DELETE' });
    toast('已撤销手机访问权限');
    await Promise.all([refreshAccessManagement(), refresh()]);
  } catch (error) {
    toast(error.message === 'approval_not_found' ? '该授权已被撤销' : error.message);
    await refreshAccessManagement();
  }
}

async function openUpdateManagement() {
  openManagementPanel('monitor-update-management');
  renderManagementLoading('monitor-update-files-list', '正在读取缓存文件…');
  await refreshUpdateManagement();
}

async function refreshUpdateManagement() {
  try {
    const result = await api('/api/admin/updates');
    renderUpdateSync(result.sync || {});
    renderManagementList(
      'monitor-update-files-list',
      result.files || [],
      (file) => managementItem(
        file.name,
        `${formatBytes(file.size)} · 更新于 ${relativeTime(file.updatedAt)}`,
        [managementAction('删除', 'danger-action', () => confirmDeleteUpdate(file.name))],
        'monitor-update-file-name'
      ),
      '缓存目录暂时为空。自动同步完成后，客户端仍使用原有更新地址下载。'
    );
  } catch (error) {
    if (error.message === 'admin_auth_required') return showLogin();
    renderManagementLoading('monitor-update-files-list', '更新缓存读取失败。');
    toast(error.message);
  }
}

function renderUpdateSync(sync = {}) {
  const labels = {
    idle: '等待首次同步',
    syncing: '正在从更新源下载并校验',
    ready: `已缓存 v${sync.version || '--'}`,
    error: '自动同步失败',
    disabled: '自动同步已关闭'
  };
  const details = [];
  if (sync.source) details.push(sync.source);
  if (sync.lastSuccessAt) details.push(`完成于 ${relativeTime(sync.lastSuccessAt)}`);
  if (sync.error) details.push(sync.error);
  $('monitor-update-sync-copy').textContent = `${labels[sync.status] || '状态未知'}${details.length ? ` · ${details.join(' · ')}` : ''}`;
  $('monitor-sync-updates').disabled = sync.status === 'syncing';
  $('monitor-sync-updates').textContent = sync.status === 'syncing' ? '同步中…' : '立即同步';
}

async function syncUpdatesNow() {
  const button = $('monitor-sync-updates');
  button.disabled = true;
  button.textContent = '同步中…';
  try {
    const result = await api('/api/admin/updates/sync', { method: 'POST' });
    toast(result.sync?.version ? `已缓存 v${result.sync.version}` : '更新缓存已同步');
  } catch (error) {
    toast(error.payload?.message || error.message);
  } finally {
    await refreshUpdateManagement();
    await refresh();
  }
}

function confirmDeleteUpdate(filename) {
  showConfirmation(
    () => void deleteUpdateFile(filename),
    { title: '删除更新文件', copy: `确定删除 ${filename} 吗？删除后客户端可能无法从内部服务器下载对应版本。`, accept: '确认删除' }
  );
}

async function deleteUpdateFile(filename) {
  try {
    await api(`/api/admin/updates/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    toast('更新文件已删除');
    await refreshUpdateManagement();
  } catch (error) {
    toast(error.message);
  }
}

async function uploadUpdateFiles(event) {
  const files = Array.from(event.currentTarget.files || []);
  if (!files.length) return;
  const progress = $('monitor-upload-progress');
  const bar = progress.querySelector('i');
  const copy = progress.querySelector('span');
  progress.classList.remove('hidden');
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    copy.textContent = `正在上传 ${file.name} (${index + 1}/${files.length})`;
    bar.style.width = `${Math.round(index / files.length * 100)}%`;
    try {
      const response = await fetch(`/api/admin/updates/${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '上传失败');
    } catch (error) {
      toast(error.message);
      break;
    }
  }
  bar.style.width = '100%';
  copy.textContent = '上传完成';
  setTimeout(() => progress.classList.add('hidden'), 700);
  event.currentTarget.value = '';
  await refreshUpdateManagement();
}

function renderManagementList(id, items, renderItem, emptyCopy) {
  const root = $(id);
  root.replaceChildren();
  if (!items.length) {
    renderManagementLoading(id, emptyCopy);
    return;
  }
  root.append(...items.map(renderItem));
}

function renderManagementLoading(id, copy) {
  const empty = document.createElement('div');
  empty.className = 'monitor-management-empty';
  empty.textContent = copy;
  $(id).replaceChildren(empty);
}

function managementItem(titleText, detailText, actions = [], titleClass = '') {
  const item = document.createElement('article');
  item.className = 'monitor-management-item';
  const copy = document.createElement('div');
  copy.className = 'monitor-management-copy';
  const title = document.createElement('strong');
  title.className = titleClass;
  title.textContent = titleText;
  const detail = document.createElement('span');
  detail.textContent = detailText;
  copy.append(title, detail);
  const actionRoot = document.createElement('div');
  actionRoot.className = 'monitor-management-actions';
  actionRoot.append(...actions);
  item.append(copy, actionRoot);
  return item;
}

function managementAction(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `monitor-management-action ${className}`;
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await handler(); } finally { button.disabled = false; }
  });
  return button;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
}

function openNotificationSettings() {
  if (!overview?.notifications) return;
  populateNotificationSettings(overview.notifications);
  const backdrop = $('monitor-notification-settings');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => backdrop.classList.add('visible'));
}

function closeNotificationSettings() {
  const backdrop = $('monitor-notification-settings');
  backdrop.classList.remove('visible');
  setTimeout(() => backdrop.classList.add('hidden'), 200);
  $('monitor-notification-settings-error').textContent = '';
}

function populateNotificationSettings(status) {
  const settings = status?.settings || {};
  $('monitor-notification-enabled').checked = settings.enabled !== false;
  $('monitor-notification-audio-enabled').checked = settings.audioEnabled !== false;
  $('monitor-notification-camera-enabled').checked = settings.cameraEnabled !== false;
  $('monitor-notification-recovery-enabled').checked = settings.recoveryEnabled !== false;
  $('monitor-notification-audio-seconds').value = String(Number(settings.audioAlertSeconds) || 120);
  $('monitor-notification-camera-minutes').value = String(Math.max(1, Math.round((Number(settings.cameraAlertSeconds) || 600) / 60)));
  $('monitor-notification-configured-hint').textContent = status?.configured
    ? '机器人已配置，保存后立即生效'
    : '服务器尚未配置机器人 Webhook，设置会保留但暂不发送';
  $('monitor-notification-settings-saved').textContent = status?.settingsUpdatedAt
    ? `上次保存 ${relativeTime(status.settingsUpdatedAt)}`
    : '当前为默认设置';
  syncNotificationSettingsControls();
}

function syncNotificationSettingsControls() {
  const enabled = $('monitor-notification-enabled').checked;
  const audioEnabled = enabled && $('monitor-notification-audio-enabled').checked;
  const cameraEnabled = enabled && $('monitor-notification-camera-enabled').checked;
  $('monitor-notification-options').classList.toggle('disabled', !enabled);
  $('monitor-notification-audio-enabled').disabled = !enabled;
  $('monitor-notification-camera-enabled').disabled = !enabled;
  $('monitor-notification-recovery-enabled').disabled = !enabled;
  $('monitor-notification-audio-seconds').disabled = !audioEnabled;
  $('monitor-notification-camera-minutes').disabled = !cameraEnabled;
}

function notificationSettingsFromForm() {
  const audioAlertSeconds = Number($('monitor-notification-audio-seconds').value);
  const cameraMinutes = Number($('monitor-notification-camera-minutes').value);
  if (!Number.isFinite(audioAlertSeconds) || audioAlertSeconds < 30 || audioAlertSeconds > 1800) {
    throw new Error('音频推送时间请输入 30–1800 秒');
  }
  if (!Number.isFinite(cameraMinutes) || cameraMinutes < 1 || cameraMinutes > 60) {
    throw new Error('机位推送时间请输入 1–60 分钟');
  }
  return {
    enabled: $('monitor-notification-enabled').checked,
    audioEnabled: $('monitor-notification-audio-enabled').checked,
    cameraEnabled: $('monitor-notification-camera-enabled').checked,
    recoveryEnabled: $('monitor-notification-recovery-enabled').checked,
    audioAlertSeconds: Math.round(audioAlertSeconds),
    cameraAlertSeconds: Math.round(cameraMinutes * 60)
  };
}

async function saveNotificationSettings(event) {
  event.preventDefault();
  const saveButton = $('monitor-notification-settings-save');
  $('monitor-notification-settings-error').textContent = '';
  try {
    const settings = notificationSettingsFromForm();
    saveButton.disabled = true;
    saveButton.textContent = '正在应用';
    const status = await api('/api/monitor/notification-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    overview.notifications = status;
    toast('企业微信通知设置已更新');
    closeNotificationSettings();
    render();
  } catch (error) {
    $('monitor-notification-settings-error').textContent = error.payload?.message || error.message || '设置保存失败';
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = '应用设置';
  }
}

async function resetNotificationSettings() {
  const resetButton = $('monitor-notification-settings-reset');
  $('monitor-notification-settings-error').textContent = '';
  try {
    resetButton.disabled = true;
    resetButton.textContent = '正在恢复';
    const status = await api('/api/monitor/notification-settings/reset', { method: 'POST' });
    overview.notifications = status;
    populateNotificationSettings(status);
    toast('已恢复企业微信通知默认设置');
    render();
  } catch (error) {
    $('monitor-notification-settings-error').textContent = error.payload?.message || error.message || '恢复默认失败';
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = '恢复默认';
  }
}

function renderDrawer(device) {
  $('monitor-device-title').textContent = device.roomName;
  $('monitor-device-subtitle').textContent = `${device.label} · ${device.online ? '电脑在线' : `离线 ${relativeTime(device.lastSeenAt)}`}`;
  const detail = $('monitor-device-detail');
  const sections = [
    roomNameSection(device),
    roomNotificationSection(device),
    detailSection('运行状态', [
      ['OBS', obsDisplay(device.obs)],
      ['音频', `${device.audio.display} · ${device.audio.levelDb == null ? '-- dB' : `${device.audio.levelDb.toFixed(1)} dB`}`],
      ['当前机位', device.atem.connected
        ? device.atem.exempt
          ? `${device.atem.programName || `PGM ${device.atem.programInput}`} · 出镜机位，不计时`
          : `${device.atem.programName || `PGM ${device.atem.programInput}`} · ${formatDuration(device.atem.elapsedSeconds)}`
        : 'ATEM 未连接'],
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
      ['最后同步', relativeTime(device.service.lastSyncAt || device.stateUpdatedAt)]
    ])
  ];
  if (device.diagnostics?.latestError) {
    const latestError = device.diagnostics.latestError;
    sections.push(detailSection('最近客户端错误', [
      ['时间', relativeTime(latestError.occurredAt)],
      ['位置', latestError.source || '主进程'],
      ['错误', latestError.message || latestError.code || '未知错误'],
      ['重复次数', String(Math.max(1, Number(latestError.count) || 1))]
    ]));
  }
  detail.replaceChildren(...sections);

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
  const weComButton = document.createElement('button');
  weComButton.type = 'button';
  weComButton.className = 'monitor-action primary-action';
  weComButton.textContent = '发送企业微信测试';
  weComButton.disabled = device.weComNotificationsEnabled === false;
  if (weComButton.disabled) weComButton.title = '该直播间已关闭企业微信通知';
  weComButton.addEventListener('click', () => void sendWeComTest(device.uuid));
  actions.append(weComButton);
}

function roomNameSection(device) {
  const section = document.createElement('section');
  section.className = 'monitor-name-editor';
  const heading = document.createElement('h3');
  heading.textContent = '直播间名称';
  const copy = document.createElement('p');
  copy.textContent = device.online
    ? '修改后会立即同步到这台检测电脑。'
    : '电脑当前离线，名称会在下次连接时自动同步。';
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.id = 'monitor-room-name-input';
  input.name = 'roomName';
  input.type = 'text';
  input.autocomplete = 'off';
  input.minLength = 2;
  input.maxLength = 60;
  input.value = device.roomName;
  input.setAttribute('aria-label', '直播间名称');
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = '更新名称';
  const syncButtonState = () => {
    const nextName = input.value.trim();
    button.disabled = nextName.length < 2 || nextName === device.roomName;
  };
  input.addEventListener('input', syncButtonState);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void renameDevice(device.uuid, input.value, button);
  });
  syncButtonState();
  form.append(input, button);
  section.append(heading, copy, form);
  return section;
}

function roomNotificationSection(device) {
  const section = document.createElement('section');
  section.className = 'monitor-room-notification-setting';
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = '企业微信通知';
  const description = document.createElement('small');
  description.textContent = device.weComNotificationsEnabled === false
    ? '该直播间不发送报警、恢复和测试消息。'
    : '该直播间会按监控中心的统一规则发送通知。';
  copy.append(title, description);

  const label = document.createElement('label');
  label.className = 'monitor-room-notification-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'monitor-switch-input';
  input.checked = device.weComNotificationsEnabled !== false;
  input.setAttribute('aria-label', `允许${device.roomName}发送企业微信通知`);
  const visual = document.createElement('i');
  visual.className = 'monitor-switch';
  input.addEventListener('change', () => void updateRoomNotificationPreference(device.uuid, input.checked, input));
  label.append(input, visual);
  section.append(copy, label);
  return section;
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

async function renameDevice(deviceUuid, roomName, button) {
  const nextName = String(roomName || '').trim();
  if (nextName.length < 2) return;
  button.disabled = true;
  button.textContent = '同步中';
  try {
    const result = await api(`/api/monitor/devices/${encodeURIComponent(deviceUuid)}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: nextName })
    });
    toast(result.synced ? '名称已更新并同步到电脑' : '名称已更新，电脑下次连接时同步');
    await refresh();
  } catch (error) {
    toast(error.payload?.message || error.message || '名称更新失败');
    const current = findDevice(deviceUuid);
    if (current) renderDrawer(current);
  }
}

async function updateRoomNotificationPreference(deviceUuid, enabled, input) {
  input.disabled = true;
  try {
    await api(`/api/monitor/devices/${encodeURIComponent(deviceUuid)}/wecom-notifications`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    toast(enabled ? '已恢复该直播间的企业微信通知' : '已关闭该直播间的企业微信通知');
    await refresh();
  } catch (error) {
    input.checked = !enabled;
    toast(error.payload?.message || error.message || '通知设置更新失败');
  } finally {
    const current = findDevice(deviceUuid);
    if (current) renderDrawer(current);
  }
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

async function sendWeComTest(deviceUuid) {
  const actionButtons = [...$('monitor-device-actions').querySelectorAll('button')];
  actionButtons.forEach((button) => { button.disabled = true; });
  try {
    const result = await api(`/api/monitor/devices/${encodeURIComponent(deviceUuid)}/wecom-test`, {
      method: 'POST'
    });
    toast(result.message || '企业微信测试消息已发送');
  } catch (error) {
    toast(error.payload?.message || error.message || '企业微信测试发送失败');
  } finally {
    const current = findDevice(deviceUuid);
    if (current) renderDrawer(current);
  }
}

function showConfirmation(action, options = {}) {
  pendingConfirmedAction = action;
  $('monitor-confirm-title').textContent = options.title || '暂停检测';
  $('monitor-confirm-copy').textContent = options.copy || '暂停后电脑仍保持在线，但不会触发音频报警。';
  $('monitor-confirm-accept').textContent = options.accept || '确认暂停';
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

function durationSettingText(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value > 0 && value % 60 === 0) return `${value / 60} 分钟`;
  return `${value} 秒`;
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
$('monitor-access-button').addEventListener('click', () => void openAccessManagement());
$('monitor-access-close').addEventListener('click', () => closeManagementPanel('monitor-access-management'));
$('monitor-access-management').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeManagementPanel('monitor-access-management');
});
$('monitor-updates-button').addEventListener('click', () => void openUpdateManagement());
$('monitor-update-close').addEventListener('click', () => closeManagementPanel('monitor-update-management'));
$('monitor-update-management').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeManagementPanel('monitor-update-management');
});
$('monitor-sync-updates').addEventListener('click', () => void syncUpdatesNow());
$('monitor-update-files').addEventListener('change', (event) => void uploadUpdateFiles(event));
$('monitor-notification-settings-button').addEventListener('click', openNotificationSettings);
$('monitor-notify-chip').addEventListener('click', openNotificationSettings);
$('monitor-notification-settings-close').addEventListener('click', closeNotificationSettings);
$('monitor-notification-settings-cancel').addEventListener('click', closeNotificationSettings);
$('monitor-notification-settings').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeNotificationSettings();
});
$('monitor-notification-settings-form').addEventListener('submit', (event) => void saveNotificationSettings(event));
$('monitor-notification-settings-reset').addEventListener('click', () => void resetNotificationSettings());
$('monitor-notification-enabled').addEventListener('change', syncNotificationSettingsControls);
$('monitor-notification-audio-enabled').addEventListener('change', syncNotificationSettingsControls);
$('monitor-notification-camera-enabled').addEventListener('change', syncNotificationSettingsControls);
$('monitor-confirm-cancel').addEventListener('click', closeConfirmation);
$('monitor-confirm-accept').addEventListener('click', () => {
  const action = pendingConfirmedAction;
  closeConfirmation();
  action?.();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('monitor-confirm').classList.contains('hidden')) closeConfirmation();
    else if (!$('monitor-access-management').classList.contains('hidden')) closeManagementPanel('monitor-access-management');
    else if (!$('monitor-update-management').classList.contains('hidden')) closeManagementPanel('monitor-update-management');
    else if (!$('monitor-notification-settings').classList.contains('hidden')) closeNotificationSettings();
    else closeDrawer();
  }
});
document.addEventListener('visibilitychange', scheduleRefresh);
void refresh();
