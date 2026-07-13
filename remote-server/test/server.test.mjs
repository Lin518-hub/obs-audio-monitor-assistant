import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

const port = 18900 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const root = await mkdtemp(join(tmpdir(), 'obs-remote-server-'));
let child;

before(async () => {
  child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, ADMIN_PASSWORD: 'remote-admin-test-password', DATA_DIR: join(root, 'data'), UPDATE_DIR: join(root, 'updates') },
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

test('requires approval before a mobile browser receives access', async () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const registered = await request('/api/devices/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uuid, secret: '1'.repeat(64), label: 'Test Desktop' }) });
  assert.equal(registered.response.status, 200);
  const pairToken = registered.body.device.pairUrl.split('/').at(-1);

  const paired = await request('/api/pair/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairToken, clientId: '22222222-2222-4222-8222-222222222222', roomName: '测试直播间', clientName: '测试平板' }) });
  assert.equal(paired.response.status, 201);
  assert.equal(paired.body.request.status, 'pending');

  const login = await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'remote-admin-test-password' }) });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.equal(login.response.status, 200);

  const approved = await request(`/api/admin/requests/${paired.body.request.id}/approve`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(approved.body.request.status, 'approved');

  const status = await request(`/api/pair/request/${paired.body.request.id}?clientId=22222222-2222-4222-8222-222222222222`);
  assert.ok(status.body.accessToken);
  const replacedPair = await request('/api/pair/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairToken, clientId: '22222222-2222-4222-8222-222222222222', roomName: '测试直播间', clientName: '测试平板' }) });
  await request(`/api/admin/requests/${replacedPair.body.request.id}/approve`, { method: 'POST', headers: { Cookie: cookie } });
  const replacedStatus = await request(`/api/pair/request/${replacedPair.body.request.id}?clientId=22222222-2222-4222-8222-222222222222`);
  const oldSession = await request(`/api/mobile/session?token=${encodeURIComponent(status.body.accessToken)}`);
  assert.equal(oldSession.response.status, 403);
  const primaryAccessToken = replacedStatus.body.accessToken;

  const session = await request(`/api/mobile/session?token=${encodeURIComponent(primaryAccessToken)}`);
  assert.equal(session.response.status, 200);
  assert.equal(session.body.device.uuid, uuid);

  const secondPair = await request('/api/pair/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairToken, clientId: '33333333-3333-4333-8333-333333333333', roomName: '测试直播间', clientName: '备用手机' }) });
  await request(`/api/admin/requests/${secondPair.body.request.id}/approve`, { method: 'POST', headers: { Cookie: cookie } });
  const secondStatus = await request(`/api/pair/request/${secondPair.body.request.id}?clientId=33333333-3333-4333-8333-333333333333`);

  const wsBase = base.replace('http:', 'ws:');
  const desktop = trackedSocket(`${wsBase}/ws/desktop?uuid=${encodeURIComponent(uuid)}&secret=${'1'.repeat(64)}`);
  await desktop.open();
  desktop.socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'command') desktop.socket.send(JSON.stringify({ type: 'command-result', id: message.id, ok: true, message: 'done' }));
  });
  const mobile = trackedSocket(`${wsBase}/ws/mobile?token=${encodeURIComponent(primaryAccessToken)}`);
  const secondMobile = trackedSocket(`${wsBase}/ws/mobile?token=${encodeURIComponent(secondStatus.body.accessToken)}`);
  await Promise.all([mobile.open(), secondMobile.open()]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  mobile.clear();
  secondMobile.clear();

  desktop.socket.send(JSON.stringify({ type: 'meter', meter: { timestamp: Date.now(), activeInputName: 'Mic', levelDb: -18.25 } }));
  const [meter, secondMeter] = await Promise.all([mobile.next(), secondMobile.next()]);
  assert.equal(meter.type, 'meter');
  assert.equal(meter.meter.activeInputName, 'Mic');
  assert.equal(meter.meter.levelDb, -18.25);
  assert.equal(secondMeter.type, 'meter');

  mobile.socket.send(JSON.stringify({ type: 'command', id: 'client-command-1', command: 'atem.auto', payload: {} }));
  const commandResult = await mobile.next();
  assert.equal(commandResult.id, 'client-command-1');
  assert.equal(commandResult.ok, true);
  await assert.rejects(secondMobile.next(120), /message_timeout/);

  const overview = await request('/api/admin/overview', { headers: { Cookie: cookie } });
  const approval = overview.body.approvals.find((item) => item.clientName === '测试平板');
  const revokedClose = new Promise((resolve) => mobile.socket.once('close', (code) => resolve(code)));
  const revoked = await request(`/api/admin/approvals/${approval.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(revoked.body.ok, true);
  assert.equal(await revokedClose, 4003);
  assert.equal(secondMobile.socket.readyState, WebSocket.OPEN);
  secondMobile.socket.send(JSON.stringify({ type: 'command', id: 'client-command-2', command: 'atem.auto', payload: {} }));
  assert.equal((await secondMobile.next()).id, 'client-command-2');
  const denied = await request(`/api/mobile/session?token=${encodeURIComponent(primaryAccessToken)}`);
  assert.equal(denied.response.status, 403);
  secondMobile.socket.close();
  desktop.socket.close();
});
