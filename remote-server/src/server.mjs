import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

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
if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');

await mkdir(dataDir, { recursive: true });
await mkdir(updateDir, { recursive: true });

const emptyData = () => ({ devices: [], requests: [], approvals: [] });
let data = await loadData();
const desktopSockets = new Map();
const mobileSockets = new Map();
const pendingCommands = new Map();
const adminSessions = new Map();
const loginAttempts = new Map();
const requestLimits = new Map();
let saveQueue = Promise.resolve();

async function loadData() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    return {
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : []
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

const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};
const now = () => Date.now();
const cleanText = (value, max = 80) => String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);
const cleanUuid = (value) => /^[0-9a-f-]{20,64}$/i.test(String(value || '')) ? String(value) : '';

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
    onlineMobileClients: mobileSockets.get(device.uuid)?.size || 0,
    lastSeenAt: device.lastSeenAt || null,
    createdAt: device.createdAt,
    pairUrl: `${publicBaseUrl}/pair/${encodeURIComponent(device.pairToken)}`
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

function notifyAdmins() {
  // Admin UI polls; this hook keeps future websocket support localized.
}

async function serveFile(res, file, cache = false) {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not_file');
    const mime = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.yml': 'text/yaml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
      '.zip': 'application/zip', '.exe': 'application/vnd.microsoft.portable-executable', '.blockmap': 'application/octet-stream'
    }[extname(file).toLowerCase()] || 'application/octet-stream';
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': info.size, 'Cache-Control': cache ? 'public, max-age=300' : 'no-store' });
    createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/devices/register') {
    if (!allowRequest(req, 'register', 60, 60_000)) return json(res, 429, { error: 'too_many_requests' });
    const body = await readJson(req);
    const uuid = cleanUuid(body.uuid);
    const secret = String(body.secret || '');
    if (!uuid || secret.length < 32) return json(res, 400, { error: 'invalid_device_credentials' });
    let device = data.devices.find((item) => item.uuid === uuid);
    if (device && !safeEqual(device.secretHash, sha256(secret))) return json(res, 403, { error: 'device_auth_failed' });
    if (!device) {
      device = { uuid, secretHash: sha256(secret), pairToken: token(24), label: cleanText(body.label, 80) || `电脑 ${uuid.slice(0, 8)}`, roomName: '', createdAt: now(), lastSeenAt: now(), lastState: null };
      data.devices.push(device);
    } else {
      device.label = cleanText(body.label, 80) || device.label;
      device.lastSeenAt = now();
    }
    await saveData();
    return json(res, 200, { ok: true, device: publicDevice(device) });
  }

  if (req.method === 'GET' && url.pathname === '/api/pair/info') {
    const device = deviceByPairToken(url.searchParams.get('token') || '');
    if (!device) return json(res, 404, { error: 'pair_link_invalid' });
    return json(res, 200, { device: publicDevice(device) });
  }

  if (req.method === 'POST' && url.pathname === '/api/pair/request') {
    if (!allowRequest(req, 'pair', 12, 10 * 60_000)) return json(res, 429, { error: 'too_many_requests' });
    const body = await readJson(req);
    const device = deviceByPairToken(body.pairToken || '');
    const clientId = cleanUuid(body.clientId);
    const roomName = cleanText(body.roomName, 60);
    if (!device || !clientId || roomName.length < 2) return json(res, 400, { error: 'invalid_request' });
    const recent = data.requests.find((item) => item.deviceUuid === device.uuid && item.clientId === clientId && item.status === 'pending');
    if (recent) return json(res, 200, { request: publicRequest(recent) });
    const request = { id: token(12), deviceUuid: device.uuid, clientId, clientName: cleanText(body.clientName, 60) || '移动浏览器', roomName, status: 'pending', createdAt: now() };
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
    approval.lastUsedAt = now();
    void saveData();
    return json(res, 200, { approval: publicApproval(approval), device: publicDevice(device), state: device.lastState });
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
        approvals: data.approvals.filter((item) => !item.revokedAt).map(publicApproval)
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
        if (device) device.roomName = request.roomName;
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
        return info.isFile() ? { name, size: info.size, updatedAt: info.mtimeMs } : null;
      }));
      return json(res, 200, { files: files.filter(Boolean) });
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

  return json(res, 404, { error: 'not_found' });
}

const requestListener = async (req, res) => {
  try {
    const url = new URL(req.url || '/', publicBaseUrl);
    if (url.pathname === '/health') return json(res, 200, {
      ok: true,
      desktops: desktopSockets.size,
      mobiles: Array.from(mobileSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0)
    });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/') return redirect(res, '/admin');
    if (url.pathname === '/admin') return serveFile(res, join(publicDir, 'admin.html'));
    if (url.pathname === '/remote' || url.pathname.startsWith('/pair/')) return serveFile(res, join(publicDir, 'mobile.html'));
    if (url.pathname.startsWith('/assets/')) {
      const file = resolve(publicDir, `.${url.pathname}`);
      if (!file.startsWith(publicDir)) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file, true);
    }
    if (url.pathname.startsWith('/updates/')) {
      const file = resolve(updateDir, `.${url.pathname.slice('/updates'.length)}`);
      if (!file.startsWith(updateDir)) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file, true);
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
      pairUrl: `${publicBaseUrl}/pair/${device.pairToken}`,
      onlineMobileClients: mobileSockets.get(uuid)?.size || 0
    }));
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'state' && message.state && typeof message.state === 'object') {
          device.lastState = message.state;
          device.lastSeenAt = now();
          broadcastMobile(uuid, { type: 'state', state: device.lastState });
          socket.send(JSON.stringify({ type: 'state-ack', receivedAt: now() }));
        } else if (message.type === 'latency-ping' && Number.isFinite(Number(message.sentAt))) {
          socket.send(JSON.stringify({ type: 'latency-pong', sentAt: Number(message.sentAt) }));
        } else if (message.type === 'meter' && message.meter && typeof message.meter === 'object') {
          const levelDb = Number(message.meter.levelDb);
          broadcastMobile(uuid, {
            type: 'meter',
            meter: {
              timestamp: Number.isFinite(Number(message.meter.timestamp)) ? Number(message.meter.timestamp) : now(),
              activeInputName: cleanText(message.meter.activeInputName, 100),
              levelDb: Number.isFinite(levelDb) ? Math.max(-100, Math.min(12, levelDb)) : null
            }
          });
        } else if (message.type === 'command-result') {
          const pending = pendingCommands.get(cleanText(message.id, 80));
          if (pending) {
            clearTimeout(pending.timer);
            pendingCommands.delete(cleanText(message.id, 80));
            pending.socket.commandInFlight = false;
            if (pending.socket.readyState === WebSocket.OPEN) {
              pending.socket.send(JSON.stringify({ ...message, id: pending.clientCommandId }));
            }
          }
        }
      } catch { /* ignore malformed desktop message */ }
    });
    socket.on('close', () => {
      if (desktopSockets.get(uuid) === socket) desktopSockets.delete(uuid);
      broadcastMobile(uuid, { type: 'device-status', online: false });
    });
    broadcastMobile(uuid, { type: 'device-status', online: true });
    return;
  }

  const approval = approvalByToken(url.searchParams.get('token') || '');
  if (!approval) return socket.close(4003, 'access_denied');
  const device = data.devices.find((item) => item.uuid === approval.deviceUuid);
  if (!device) return socket.close(4004, 'device_not_found');
  const sockets = mobileSockets.get(device.uuid) || new Set();
  socket.approvalId = approval.id;
  socket.commandInFlight = false;
  sockets.add(socket);
  mobileSockets.set(device.uuid, sockets);
  notifyDesktopPresence(device.uuid);
  approval.lastUsedAt = now();
  socket.send(JSON.stringify({ type: 'state', state: device.lastState }));
  socket.send(JSON.stringify({ type: 'device-status', online: desktopSockets.has(device.uuid) }));
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'command') return;
      const clientCommandId = cleanText(message.id, 80);
      if (!clientCommandId) return socket.send(JSON.stringify({ type: 'command-result', id: '', ok: false, message: '操作编号无效' }));
      if (socket.commandInFlight) return socket.send(JSON.stringify({ type: 'command-result', id: clientCommandId, ok: false, message: '上一项操作仍在执行' }));
      const allowed = ['atem.preview', 'atem.auto'];
      if (!allowed.includes(message.command)) return socket.send(JSON.stringify({ type: 'command-result', id: clientCommandId, ok: false, message: '不允许的远程操作' }));
      if (message.command === 'atem.auto' && message.payload?.confirmed !== true) return socket.send(JSON.stringify({ type: 'command-result', id: clientCommandId, ok: false, message: '请先完成二次确认' }));
      const desktop = desktopSockets.get(device.uuid);
      if (!desktop || desktop.readyState !== WebSocket.OPEN) return socket.send(JSON.stringify({ type: 'command-result', id: clientCommandId, ok: false, message: '电脑当前离线' }));
      socket.commandInFlight = true;
      const relayId = token(12);
      const timer = setTimeout(() => {
        const pending = pendingCommands.get(relayId);
        pendingCommands.delete(relayId);
        socket.commandInFlight = false;
        if (pending?.socket.readyState === WebSocket.OPEN) {
          pending.socket.send(JSON.stringify({ type: 'command-result', id: clientCommandId, ok: false, message: '电脑响应超时' }));
        }
      }, 12_000);
      pendingCommands.set(relayId, { socket, clientCommandId, timer });
      desktop.send(JSON.stringify({ type: 'command', id: relayId, command: message.command, payload: message.payload || {} }));
    } catch { /* ignore malformed mobile message */ }
  });
  socket.on('close', () => {
    for (const [id, pending] of pendingCommands) {
      if (pending.socket === socket) {
        clearTimeout(pending.timer);
        pendingCommands.delete(id);
      }
    }
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
  for (const pending of pendingCommands.values()) clearTimeout(pending.timer);
  pendingCommands.clear();
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
