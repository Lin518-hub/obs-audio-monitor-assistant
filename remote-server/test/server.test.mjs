import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

const port = 18900 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const root = await mkdtemp(join(tmpdir(), 'obs-remote-server-'));
let child;

before(async () => {
  const dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'remote-state.json'), JSON.stringify({
    devices: [{ uuid: 'legacy-mobile-device', roomName: '旧直播间' }],
    requests: [{ id: 'legacy-request' }],
    approvals: [{ id: 'legacy-approval' }],
    commands: []
  }));
  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, ADMIN_PASSWORD: 'remote-admin-test-password', DATA_DIR: dataDir, UPDATE_DIR: join(root, 'updates'), UPDATE_SYNC_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
});

after(async () => {
  child?.kill('SIGTERM');
  await rm(root, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
}

function trackedSocket(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else queue.push(message);
  });
  return {
    socket,
    open: () => new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }),
    next: (timeout = 1000) => queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('message_timeout'));
      }, timeout);
    }),
    clear: () => { queue.length = 0; }
  };
}

test('removes legacy mobile pairing and keeps one monitoring identity per room', async () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const registered = await request('/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid,
      secret: '1'.repeat(64),
      label: 'Test Desktop',
      roomName: '测试直播间',
      roomNameRevision: 0,
      monitoringIdentityRevision: 1,
      appVersion: '3.9.1'
    })
  });
  assert.equal(registered.response.status, 200);
  assert.equal(registered.body.device.pairUrl, null);
  assert.equal(registered.body.device.mobileAccessEnabled, false);

  const pairInfo = await request('/api/pair/info?token=legacy');
  assert.equal(pairInfo.response.status, 410);
  assert.equal(pairInfo.body.error, 'mobile_access_removed');
  const pairRequest = await request('/api/pair/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairToken: 'legacy' })
  });
  assert.equal(pairRequest.response.status, 410);

  const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'remote-admin-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.equal(login.response.status, 200);
  const overview = await request('/api/admin/overview', { headers: { Cookie: cookie } });
  assert.deepEqual(overview.body.requests, []);
  assert.deepEqual(overview.body.approvals, []);

  const replacementUuid = '22222222-2222-4222-8222-222222222222';
  const replacement = await request('/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid: replacementUuid,
      secret: '2'.repeat(64),
      label: 'Replacement Desktop',
      roomName: '测试直播间',
      roomNameRevision: 0,
      monitoringIdentityRevision: 1,
      appVersion: '3.9.1'
    })
  });
  assert.equal(replacement.response.status, 200);
  const replacedOverview = await request('/api/admin/overview', { headers: { Cookie: cookie } });
  assert.equal(replacedOverview.body.devices.some((item) => item.uuid === uuid), false);
  assert.equal(replacedOverview.body.devices.some((item) => item.uuid === replacementUuid), true);
});

test('protects and aggregates the live room monitor', async () => {
  const denied = await request('/api/monitor/overview');
  assert.equal(denied.response.status, 401);

  const devices = [
    { uuid: '44444444-4444-4444-8444-444444444444', secret: '4'.repeat(64), label: '主控电脑' },
    { uuid: '55555555-5555-4555-8555-555555555555', secret: '5'.repeat(64), label: '备用电脑' }
  ];
  for (const [index, device] of devices.entries()) {
    const registered = await request('/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...device,
        roomName: index === 0 ? '品牌一号直播间' : '品牌二号直播间',
        roomNameRevision: 0,
        monitoringIdentityRevision: 1,
        appVersion: '3.9.1'
      })
    });
    assert.equal(registered.response.status, 200);
  }

  const wsBase = base.replace('http:', 'ws:');
  const primary = trackedSocket(`${wsBase}/ws/desktop?uuid=${devices[0].uuid}&secret=${devices[0].secret}`);
  const backup = trackedSocket(`${wsBase}/ws/desktop?uuid=${devices[1].uuid}&secret=${devices[1].secret}`);
  await Promise.all([primary.open(), backup.open()]);
  const timestamp = Date.now();
  primary.socket.send(JSON.stringify({
    type: 'state',
    state: {
      timestamp,
      audio: {
        ready: true, phase: 'alert', tone: 'danger', inputName: '主播麦克风', levelDb: -80,
        thresholdDb: -55, silentForSeconds: 121, silenceDurationSeconds: 120, display: '检查麦克风',
        hint: '连续静音', lastMeterReceivedAt: timestamp
      },
      atem: { connected: true, programInput: 1, previewInput: 2, inputLabels: { 1: '主播近景', 2: '商品特写' }, elapsedSeconds: 60, limitSeconds: 720, overLimit: false },
      obs: { connected: true, streaming: true, recording: false, fps: 60, cpu: 8.5, bitrateKbps: 6000 },
      service: { routeType: 'lan', latencyMs: 7, lastSyncAt: timestamp }
    }
  }));
  backup.socket.send(JSON.stringify({
    type: 'state',
    state: {
      timestamp,
      audio: {
        ready: true, phase: 'speaking', tone: 'safe', inputName: '备用麦克风', levelDb: -22,
        thresholdDb: -55, silentForSeconds: 0, silenceDurationSeconds: 120, display: '正在讲话',
        hint: '音频正常', lastMeterReceivedAt: timestamp - 60_000, meterAgeMs: 120
      },
      atem: { connected: true, programInput: 3, previewInput: 4, inputLabels: { 3: '全景', 4: '手部特写' }, elapsedSeconds: 650, limitSeconds: 720, overLimit: false },
      obs: { connected: true, streaming: true, recording: true, fps: 59.94, cpu: 11, bitrateKbps: 5800 },
      service: { routeType: 'public', latencyMs: 42, lastSyncAt: timestamp }
    }
  }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const login = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'remote-admin-test-password' })
  });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const monitor = await request('/api/monitor/overview', { headers: { Cookie: cookie } });
  assert.equal(monitor.response.status, 200);
  const room = monitor.body.rooms.find((item) => item.name === '品牌一号直播间');
  assert.ok(room);
  assert.equal(room.totalDevices, 1);
  assert.equal(room.onlineDevices, 1);
  assert.equal(room.activeLiveDevices, 1);
  assert.equal(room.alertCount, 1);
  assert.equal(room.warningCount, 0);
  assert.equal(room.devices[0].audio.inputName.length > 0, true);
  assert.equal(room.devices[0].audio.silenceDurationSeconds, 120);
  assert.equal(room.devices[0].audio.dangerProgress, 1);
  assert.equal(monitor.body.summary.onlineDevices >= 2, true);
  const backupRoom = monitor.body.rooms.find((item) => item.name === '品牌二号直播间');
  assert.equal(backupRoom.devices[0].audio.ready, true);
  assert.equal(backupRoom.devices[0].audio.display, '正在讲话');
  assert.equal(backupRoom.devices[0].atem.limitSeconds, 600);
  assert.equal(backupRoom.devices[0].atem.overLimit, true);
  assert.equal(backupRoom.devices[0].atem.tone, 'danger');

  primary.clear();
  const commandRequest = request(`/api/monitor/devices/${devices[0].uuid}/commands`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'show_app' })
  });
  const command = await primary.next();
  assert.equal(command.type, 'admin-command');
  assert.equal(command.command, 'show_app');
  primary.socket.send(JSON.stringify({ type: 'admin-command-result', id: command.id, ok: true, message: '已打开' }));
  const commandResponse = await commandRequest;
  assert.equal(commandResponse.response.status, 200);
  assert.equal(commandResponse.body.status, 'success');
  assert.equal(commandResponse.body.message, '已打开');

  primary.clear();
  const renameRequest = request(`/api/monitor/devices/${devices[0].uuid}/name`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: '品牌旗舰直播间' })
  });
  const renamedConfig = await primary.next();
  const renameResponse = await renameRequest;
  assert.equal(renameResponse.response.status, 200);
  assert.equal(renameResponse.body.synced, true);
  assert.equal(renameResponse.body.device.roomName, '品牌旗舰直播间');
  assert.equal(renamedConfig.type, 'device-config');
  assert.equal(renamedConfig.roomName, '品牌旗舰直播间');
  assert.equal(renamedConfig.roomNameRevision, 2);

  const staleRegistration = await request('/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...devices[0],
      roomName: '品牌一号直播间',
      roomNameRevision: 0,
      monitoringIdentityRevision: 1,
      appVersion: '3.9.3'
    })
  });
  assert.equal(staleRegistration.response.status, 200);
  assert.equal(staleRegistration.body.device.roomName, '品牌旗舰直播间');
  assert.equal(staleRegistration.body.device.roomNameRevision, 2);

  const duplicateRename = await request(`/api/monitor/devices/${devices[0].uuid}/name`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: '品牌二号直播间' })
  });
  assert.equal(duplicateRename.response.status, 409);
  assert.equal(duplicateRename.body.error, 'room_name_in_use');

  const pauseWithoutConfirmation = await request(`/api/monitor/devices/${devices[0].uuid}/commands`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'pause_monitoring' })
  });
  assert.equal(pauseWithoutConfirmation.response.status, 409);
  assert.equal(pauseWithoutConfirmation.body.error, 'confirmation_required');

  const refreshedMonitor = await request('/api/monitor/overview', { headers: { Cookie: cookie } });
  assert.equal(refreshedMonitor.body.commands.recent[0].command, 'rename_device');
  assert.equal(refreshedMonitor.body.commands.recent[0].status, 'success');
  assert.equal(refreshedMonitor.body.commands.recent.some((item) => item.command === 'show_app' && item.status === 'success'), true);

  const page = await fetch(`${base}/monitor`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /直播间监控中心/);
  primary.socket.close();
  backup.socket.close();
});

test('keeps central monitoring always on and recognizes the reported app version', async () => {
  const uuid = '66666666-6666-4666-8666-666666666666';
  const secret = '6'.repeat(64);
  const registered = await request('/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uuid,
      secret,
      label: '只上报电脑',
      roomName: '后台监控直播间',
      roomNameRevision: 0,
      mobileAccessEnabled: false,
      monitoringIdentityRevision: 1,
      appVersion: 'unknown',
      platform: 'win32',
      arch: 'x64'
    })
  });
  assert.equal(registered.response.status, 200);
  assert.equal(registered.body.device.mobileAccessEnabled, false);
  assert.equal(registered.body.device.pairUrl, null);
  const wsBase = base.replace('http:', 'ws:');
  const desktop = trackedSocket(`${wsBase}/ws/desktop?uuid=${uuid}&secret=${secret}`);
  await desktop.open();
  desktop.socket.send(JSON.stringify({
    type: 'state',
    state: {
      timestamp: Date.now(),
      app: {
        updateCurrentVersion: '3.9.1',
        updateAvailableVersion: '3.9.1',
        updateDownloadedVersion: 'v3.9.1',
        platform: 'win32',
        arch: 'x64',
        paused: false,
        autoUpdateEnabled: true
      },
      audio: { ready: false, levelDb: null, lastMeterReceivedAt: null },
      atem: { connected: false },
      obs: { connected: false },
      service: { routeType: 'public', latencyMs: 38 }
    }
  }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const login = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'remote-admin-test-password' })
  });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const monitor = await request('/api/monitor/overview', { headers: { Cookie: cookie } });
  const device = monitor.body.rooms.flatMap((room) => room.devices).find((item) => item.uuid === uuid);
  assert.ok(device);
  assert.equal(device.online, true);
  assert.equal(device.app.version, '3.9.1');
  assert.equal(device.app.updateAvailable, false);
  assert.equal(device.app.updateAvailableVersion, null);
  assert.equal(device.app.updateDownloadedVersion, null);
  assert.equal(device.app.mobileAccessEnabled, false);

  const weComTest = await request(`/api/monitor/devices/${uuid}/wecom-test`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(weComTest.response.status, 503);
  assert.match(weComTest.body.message, /尚未配置企业微信机器人/);

  const monitorPage = await fetch(`${base}/monitor`);
  const monitorHtml = await monitorPage.text();
  assert.match(monitorHtml, /monitor-room-columns/);
  assert.match(monitorHtml, /直播间状态列表/);
  desktop.socket.close();
});

test('serves the native picture-in-picture video with byte ranges', async () => {
  const response = await fetch(`${base}/assets/pip-audio-threshold-55.mp4`, {
    headers: { Range: 'bytes=0-99' }
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.match(response.headers.get('content-range') || '', /^bytes 0-99\/\d+$/);
  assert.equal((await response.arrayBuffer()).byteLength, 100);
});
