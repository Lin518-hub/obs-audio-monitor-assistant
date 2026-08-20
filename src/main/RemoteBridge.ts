import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { hostname, release } from 'node:os';
import { ProxyAgent } from 'proxy-agent';
import WebSocket from 'ws';
import { defaultATEMInputColor } from '../shared/atemPalette.js';
import { AUDIO_ALERT_SECONDS, CAMERA_ALERT_SECONDS, reminderVisualState } from '../shared/reminderTiming.js';
import { reconnectBackoffDelay } from '../shared/reconnect.js';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
  type AppConfig,
  type AppSnapshot,
  type AudioMeterFrame,
  type RemoteAccessSnapshot,
  type RemoteAdminCommand,
  type RemoteAdminCommandResult,
  type RuntimeErrorSummary,
  type UpdateSnapshot
} from '../shared/types.js';

export { LAN_REMOTE_SERVER_URL, PUBLIC_REMOTE_SERVER_URL } from '../shared/types.js';

interface RemoteBridgeEvents {
  stateChanged: [RemoteAccessSnapshot];
  roomNameChanged: [{ roomName: string; revision: number }];
}

type RemoteAdminCommandHandler = (command: RemoteAdminCommand) => Promise<RemoteAdminCommandResult>;

const SEND_INTERVAL_MS = 400;
const METER_SEND_INTERVAL_MS = 80;
const LAN_CONNECT_TIMEOUT_MS = 2500;
const PUBLIC_CONNECT_TIMEOUT_MS = 8000;
const PUBLIC_FALLBACK_DELAY_MS = 350;
const REMOTE_METER_FRESH_MS = 5000;
const RUNTIME_ERROR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class RemoteBridge extends EventEmitter<RemoteBridgeEvents> {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sendTimer: NodeJS.Timeout | null = null;
  private meterSendTimer: NodeJS.Timeout | null = null;
  private socketConnectTimer: NodeJS.Timeout | null = null;
  private latencyTimer: NodeJS.Timeout | null = null;
  private latencyPingSentAt: number | null = null;
  private latestMeterFrame: AudioMeterFrame | null = null;
  private latestSnapshot: AppSnapshot | null = null;
  private latestUpdateSnapshot: UpdateSnapshot | null = null;
  private latestRuntimeError: RuntimeErrorSummary | null = null;
  private commandHandler: RemoteAdminCommandHandler | null = null;
  private enabled = false;
  private mobileAccessEnabled = false;
  private configuredServerUrl = '';
  private serverCandidates: string[] = [];
  private serverUrl = '';
  private roomName = '';
  private roomNameRevision = 0;
  private uuid = '';
  private secret = '';
  private generation = 0;
  private reconnectAttempt = 0;
  private readonly appVersion: string;
  private readonly platform = process.platform;
  private readonly architecture = process.arch;
  private readonly osRelease = release();
  private state: RemoteAccessSnapshot = {
    connectionState: 'disabled', connected: false, activeServerUrl: null, pairUrl: null, errorMessage: null, lastConnectedAt: null,
    routeType: null, latencyMs: null, onlineMobileClients: 0, lastSyncAt: null
  };

  constructor(appVersion = 'unknown') {
    super();
    this.appVersion = appVersion;
  }

  static createDeviceIdentity(): { uuid: string; secret: string } {
    return { uuid: randomUUID(), secret: randomBytes(32).toString('hex') };
  }

  getSnapshot(): RemoteAccessSnapshot {
    return { ...this.state };
  }

  setCommandHandler(handler: RemoteAdminCommandHandler): void {
    this.commandHandler = handler;
  }

  async configure(config: AppConfig): Promise<void> {
    const normalizedUrl = normalizeServerUrl(config.remoteServerUrl);
    const roomName = config.livestreamRoomName.trim();
    const roomNameRevision = normalizedRevision(config.livestreamRoomNameRevision);
    const enabled = true;
    const mobileAccessEnabled = config.developerModeEnabled && config.remoteAccessEnabled;
    const changed = this.enabled !== enabled
      || this.mobileAccessEnabled !== mobileAccessEnabled
      || this.configuredServerUrl !== normalizedUrl
      || this.roomName !== roomName
      || this.roomNameRevision !== roomNameRevision
      || this.uuid !== config.remoteDeviceUuid
      || this.secret !== config.remoteDeviceSecret;
    this.enabled = enabled;
    this.mobileAccessEnabled = mobileAccessEnabled;
    this.configuredServerUrl = normalizedUrl;
    this.serverCandidates = remoteServerCandidates(normalizedUrl);
    this.serverUrl = this.serverCandidates[0] ?? '';
    this.roomName = roomName;
    this.roomNameRevision = roomNameRevision;
    this.uuid = config.remoteDeviceUuid;
    this.secret = config.remoteDeviceSecret;
    if (!changed) return;
    this.generation += 1;
    this.clearTimers();
    this.closeSocket();
    if (!this.roomName) {
      this.setState({
        connectionState: 'disabled',
        connected: false,
        activeServerUrl: null,
        pairUrl: null,
        errorMessage: '等待填写直播间名称',
        routeType: null,
        latencyMs: null,
        onlineMobileClients: 0
      });
      return;
    }
    await this.connect(this.generation);
  }

  updateSnapshot(snapshot: AppSnapshot): void {
    this.latestSnapshot = snapshot;
    if (!this.enabled || !this.socket || this.socket.readyState !== WebSocket.OPEN || this.sendTimer) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.sendState();
    }, SEND_INTERVAL_MS);
  }

  updateMeter(frame: AudioMeterFrame): void {
    this.latestMeterFrame = frame;
    if (!this.enabled || !this.socket || this.socket.readyState !== WebSocket.OPEN || this.meterSendTimer) return;
    this.meterSendTimer = setTimeout(() => {
      this.meterSendTimer = null;
      if (this.latestMeterFrame) {
        this.send({ type: 'meter', meter: this.latestMeterFrame });
      }
    }, METER_SEND_INTERVAL_MS);
  }

  updateUpdateState(snapshot: UpdateSnapshot): void {
    this.latestUpdateSnapshot = snapshot;
    if (this.latestSnapshot) this.updateSnapshot(this.latestSnapshot);
  }

  updateRuntimeError(summary: RuntimeErrorSummary | null): void {
    this.latestRuntimeError = summary ? { ...summary } : null;
    if (this.latestSnapshot) this.updateSnapshot(this.latestSnapshot);
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.generation += 1;
    this.clearTimers();
    this.closeSocket();
  }

  private async connect(generation: number): Promise<void> {
    if (!this.enabled || generation !== this.generation) return;
    if (!this.roomName) {
      this.setState({ connectionState: 'error', connected: false, errorMessage: '请先填写直播间名称' });
      return;
    }
    if (this.serverCandidates.length === 0 || !this.uuid || this.secret.length < 32) {
      this.setState({ connectionState: 'error', connected: false, errorMessage: '监控中心配置无效' });
      return;
    }
    this.setState({
      connectionState: 'connecting',
      connected: false,
      activeServerUrl: null,
      routeType: null,
      pairUrl: publicPairUrl(this.state.pairUrl),
      errorMessage: null
    });
    let lastError: unknown = null;
    const controllers = this.serverCandidates.map(() => new AbortController());
    const attempts = this.serverCandidates.map((candidate, index) => this.registerWithServer(
      candidate,
      index === 0 ? 0 : PUBLIC_FALLBACK_DELAY_MS,
      controllers[index].signal
    ).catch((error) => {
      lastError = error;
      throw error;
    }));

    try {
      const registered = await Promise.any(attempts);
      controllers.forEach((controller) => controller.abort());
      if (!this.enabled || generation !== this.generation) return;
      this.serverUrl = registered.serverUrl;
      this.applyServerRoomName(registered.roomName, registered.roomNameRevision);
      this.setState({
        activeServerUrl: registered.serverUrl,
        pairUrl: this.mobileAccessEnabled ? publicPairUrl(registered.pairUrl) : null,
        routeType: remoteRouteType(registered.serverUrl)
      });
      await this.openSocket(generation);
      return;
    } catch (error) {
      lastError = error;
      controllers.forEach((controller) => controller.abort());
    }

    if (!this.enabled || generation !== this.generation) return;
    this.setState({ connectionState: 'error', connected: false, activeServerUrl: null, routeType: null, errorMessage: friendlyError(lastError) });
    this.scheduleReconnect(generation);
  }

  private async registerWithServer(
    serverUrl: string,
    delayMs: number,
    signal: AbortSignal
  ): Promise<{ serverUrl: string; roomName: string; roomNameRevision: number; pairUrl: string | null }> {
    if (delayMs > 0) await abortableDelay(delayMs, signal);
    const timeout = serverUrl === LAN_REMOTE_SERVER_URL ? LAN_CONNECT_TIMEOUT_MS : PUBLIC_CONNECT_TIMEOUT_MS;
    const { session } = await import('electron');
    if (serverUrl === PUBLIC_REMOTE_SERVER_URL) {
      await Promise.allSettled([
        session.defaultSession.clearHostResolverCache(),
        session.defaultSession.forceReloadProxyConfig()
      ]);
    }
    const response = await session.defaultSession.fetch(`${serverUrl}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: this.uuid,
        secret: this.secret,
        label: hostname(),
        roomName: this.roomName,
        roomNameRevision: this.roomNameRevision,
        mobileAccessEnabled: this.mobileAccessEnabled,
        monitoringIdentityRevision: 1,
        appVersion: this.appVersion,
        platform: this.platform,
        arch: this.architecture,
        osRelease: this.osRelease
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    });
    const body = await response.json() as {
      device?: { uuid?: string; roomName?: string; roomNameRevision?: number; pairUrl?: string | null };
      error?: string;
    };
    if (!response.ok || !body.device?.uuid) throw new Error(body.error || `服务器返回 ${response.status}`);
    return {
      serverUrl,
      roomName: body.device.roomName ?? this.roomName,
      roomNameRevision: normalizedRevision(body.device.roomNameRevision),
      pairUrl: body.device.pairUrl ?? null
    };
  }

  private async openSocket(generation: number): Promise<void> {
    const wsUrl = new URL(this.serverUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.pathname = '/ws/desktop';
    wsUrl.search = new URLSearchParams({ uuid: this.uuid, secret: this.secret }).toString();
    const proxyUrl = await resolveSystemProxy(wsUrl.toString());
    if (!this.enabled || generation !== this.generation) return;
    const socket = new WebSocket(wsUrl, proxyUrl
      ? { agent: new ProxyAgent({ getProxyForUrl: () => proxyUrl }) }
      : undefined);
    this.socket = socket;
    this.socketConnectTimer = setTimeout(() => {
      if (socket === this.socket && socket.readyState !== WebSocket.OPEN) socket.terminate();
    }, this.serverUrl === LAN_REMOTE_SERVER_URL ? LAN_CONNECT_TIMEOUT_MS : PUBLIC_CONNECT_TIMEOUT_MS);
    socket.on('open', () => {
      if (socket !== this.socket || generation !== this.generation) return;
      if (this.socketConnectTimer) clearTimeout(this.socketConnectTimer);
      this.socketConnectTimer = null;
      this.reconnectAttempt = 0;
      this.setState({ connectionState: 'connected', connected: true, errorMessage: null, lastConnectedAt: Date.now() });
      this.sendState();
      this.startLatencyMonitor();
    });
    socket.on('message', (raw) => {
      if (socket !== this.socket || generation !== this.generation) return;
      try {
        const message = JSON.parse(raw.toString()) as {
          type?: string;
          pairUrl?: string;
          id?: string;
          command?: string;
          payload?: Record<string, unknown>;
          sentAt?: number;
          receivedAt?: number;
          onlineMobileClients?: number;
          roomName?: string;
          roomNameRevision?: number;
        };
        if (message.type === 'registered') {
          this.applyServerRoomName(message.roomName, message.roomNameRevision);
          this.setState({
            pairUrl: this.mobileAccessEnabled ? publicPairUrl(message.pairUrl ?? null) : null,
            onlineMobileClients: Math.max(0, Number(message.onlineMobileClients) || 0)
          });
        } else if (message.type === 'device-config') {
          this.applyServerRoomName(message.roomName, message.roomNameRevision);
        } else if (message.type === 'presence') {
          this.setState({ onlineMobileClients: Math.max(0, Number(message.onlineMobileClients) || 0) });
        } else if (message.type === 'latency-pong' && Number.isFinite(message.sentAt)) {
          this.latencyPingSentAt = null;
          this.setState({ latencyMs: Math.max(0, Date.now() - Number(message.sentAt)) });
        } else if (message.type === 'state-ack') {
          this.setState({ lastSyncAt: Number.isFinite(message.receivedAt) ? Number(message.receivedAt) : Date.now() });
        } else if (message.type === 'admin-command' && message.id && isRemoteAdminCommand(message.command)) {
          void this.executeAdminCommand(message.id, message.command);
        } else if (message.type === 'command' && message.id) {
          this.send({ type: 'command-result', id: message.id, ok: false, message: '监控中心不支持该操作' });
        }
      } catch {
        // Ignore malformed server messages.
      }
    });
    socket.on('close', () => {
      if (socket !== this.socket || generation !== this.generation) return;
      if (this.socketConnectTimer) clearTimeout(this.socketConnectTimer);
      this.socketConnectTimer = null;
      this.socket = null;
      this.stopLatencyMonitor();
      this.setState({ connectionState: 'error', connected: false, activeServerUrl: null, routeType: null, errorMessage: '监控中心连接已断开，正在重试', latencyMs: null, onlineMobileClients: 0 });
      this.scheduleReconnect(generation);
    });
    socket.on('error', () => {
      // The close event owns retry and user-facing state.
    });
  }

  private sendState(): void {
    if (!this.latestSnapshot) return;
    this.send({
      type: 'state',
      state: remoteTelemetry(
        this.latestSnapshot,
        this.latestUpdateSnapshot,
        {
          version: this.appVersion,
          platform: this.platform,
          arch: this.architecture,
          osRelease: this.osRelease,
          mobileAccessEnabled: this.mobileAccessEnabled
        },
        this.latestRuntimeError
      )
    });
  }

  private applyServerRoomName(roomName: unknown, revision: unknown): void {
    const resolved = resolveServerRoomName(
      this.roomName,
      this.roomNameRevision,
      roomName,
      revision
    );
    if (!resolved) return;
    this.roomName = resolved.roomName;
    this.roomNameRevision = resolved.revision;
    this.emit('roomNameChanged', resolved);
  }

  private async executeAdminCommand(id: string, command: RemoteAdminCommand): Promise<void> {
    if (!this.commandHandler) {
      this.send({ type: 'admin-command-result', id, ok: false, message: '电脑端暂未就绪' });
      return;
    }
    try {
      const result = await this.commandHandler(command);
      this.send({ type: 'admin-command-result', id, ...result });
    } catch (error) {
      this.send({
        type: 'admin-command-result',
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private startLatencyMonitor(): void {
    this.stopLatencyMonitor();
    const ping = () => {
      const sentAt = Date.now();
      this.latencyPingSentAt = sentAt;
      this.send({ type: 'latency-ping', sentAt });
    };
    ping();
    this.latencyTimer = setInterval(ping, 10_000);
  }

  private stopLatencyMonitor(): void {
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.latencyTimer = null;
    this.latencyPingSentAt = null;
  }

  private setState(patch: Partial<RemoteAccessSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit('stateChanged', this.getSnapshot());
  }

  private scheduleReconnect(generation: number): void {
    if (!this.enabled || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = reconnectBackoffDelay(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(generation);
    }, delay);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.meterSendTimer) clearTimeout(this.meterSendTimer);
    if (this.socketConnectTimer) clearTimeout(this.socketConnectTimer);
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.reconnectTimer = null;
    this.sendTimer = null;
    this.meterSendTimer = null;
    this.socketConnectTimer = null;
    this.latencyTimer = null;
    this.latencyPingSentAt = null;
    this.reconnectAttempt = 0;
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(); } catch { /* already closed */ }
    }
  }
}

export function remoteRouteType(serverUrl: string): RemoteAccessSnapshot['routeType'] {
  if (serverUrl === LAN_REMOTE_SERVER_URL) return 'lan';
  if (serverUrl === PUBLIC_REMOTE_SERVER_URL) return 'public';
  return serverUrl ? 'custom' : null;
}

export function resolveServerRoomName(
  currentName: string,
  currentRevision: number,
  serverName: unknown,
  serverRevision: unknown
): { roomName: string; revision: number } | null {
  const roomName = String(serverName ?? '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 60);
  const revision = normalizedRevision(serverRevision);
  if (roomName.length < 2 || revision < normalizedRevision(currentRevision)) return null;
  if (roomName === currentName.trim() && revision === normalizedRevision(currentRevision)) return null;
  return { roomName, revision };
}

function normalizedRevision(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeServerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function remoteServerCandidates(configuredUrl: string): string[] {
  const normalized = normalizeServerUrl(configuredUrl);
  if (!normalized) return [];
  if (normalized === LAN_REMOTE_SERVER_URL || normalized === PUBLIC_REMOTE_SERVER_URL) {
    return [LAN_REMOTE_SERVER_URL, PUBLIC_REMOTE_SERVER_URL];
  }
  return [normalized];
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/name_not_resolved|enotfound|nxdomain|dns/i.test(message)) {
    return '公网域名解析失败，请刷新 DNS 缓存或改用 223.5.5.5 / 119.29.29.29';
  }
  if (/timeout/i.test(message)) return '连接远程服务超时';
  if (/fetch|connect|refused|network/i.test(message)) return '无法连接远程服务，请检查服务器地址和网络';
  return message || '远程服务连接失败';
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(resolveDelay, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      rejectDelay(signal.reason);
    }, { once: true });
  });
}

export function proxyDirectiveUrl(value: string): string | null {
  const directives = value.split(';').map((item) => item.trim()).filter(Boolean);
  for (const directive of directives) {
    const [kind = '', address = ''] = directive.split(/\s+/, 2);
    if (!address || kind.toUpperCase() === 'DIRECT') continue;
    if (/^HTTPS$/i.test(kind)) return `https://${address}`;
    if (/^(PROXY|HTTP)$/i.test(kind)) return `http://${address}`;
    if (/^SOCKS5?$/i.test(kind)) return `socks5://${address}`;
    if (/^SOCKS4$/i.test(kind)) return `socks4://${address}`;
  }
  return null;
}

async function resolveSystemProxy(url: string): Promise<string | null> {
  try {
    const { session } = await import('electron');
    return proxyDirectiveUrl(await session.defaultSession.resolveProxy(url));
  } catch {
    return null;
  }
}

export function publicPairUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const pairUrl = new URL(value);
    const normalizedOrigin = pairUrl.origin.replace(/\/$/, '');
    if (normalizedOrigin !== LAN_REMOTE_SERVER_URL && normalizedOrigin !== PUBLIC_REMOTE_SERVER_URL) return value;
    const publicOrigin = new URL(PUBLIC_REMOTE_SERVER_URL);
    pairUrl.protocol = publicOrigin.protocol;
    pairUrl.hostname = publicOrigin.hostname;
    pairUrl.port = publicOrigin.port;
    return pairUrl.toString();
  } catch {
    return value;
  }
}

export function remoteAudioTelemetry(snapshot: AppSnapshot, now = Date.now()) {
  const lastMeterAt = snapshot.lastAudioMeterReceivedAt;
  const meterAgeMs = lastMeterAt === null ? null : Math.max(0, now - lastMeterAt);
  const hasFreshMeter = snapshot.lastLevelDb !== null
    && meterAgeMs !== null
    && meterAgeMs <= REMOTE_METER_FRESH_MS;
  const activelyMonitoring = snapshot.monitoringActive
    && (snapshot.readinessReason === 'ready' || snapshot.readinessReason === 'alerting');
  const ready = activelyMonitoring && hasFreshMeter;
  const audioAlertVisible = snapshot.activeAlertSource === 'audio';
  const phase = !ready
    ? 'idle'
    : audioAlertVisible
      ? 'alert'
      : snapshot.audioSpeaking || snapshot.silentForSeconds < 3
        ? 'speaking'
        : 'silent';
  const visual = reminderVisualState(snapshot.silentForSeconds, AUDIO_ALERT_SECONDS);
  const audioTone = ready ? audioAlertVisible ? 'danger' : visual.tone : '';

  let display = '--';
  let hint = '等待电脑上传音频状态';
  if (!snapshot.connected || snapshot.readinessReason === 'obs_disconnected') {
    display = 'OBS 未连接';
    hint = '请先连接 OBS WebSocket';
  } else if (snapshot.readinessReason === 'obs_connecting') {
    display = 'OBS 连接中';
    hint = '正在读取 OBS 状态';
  } else if (snapshot.readinessReason === 'not_streaming_or_recording') {
    display = '等待直播/录制';
    hint = '开始直播、录制或模拟开播后检测';
  } else if (snapshot.readinessReason === 'no_target_selected') {
    display = '未选择音源';
    hint = '请在电脑端选择需要守护的音源';
  } else if (snapshot.readinessReason === 'target_missing') {
    display = '音源不可用';
    hint = '目标音源当前不在 OBS 输入列表中';
  } else if (snapshot.readinessReason === 'paused') {
    display = '检测已暂停';
    hint = '请在电脑端恢复检测';
  } else if (!hasFreshMeter || snapshot.readinessReason === 'no_target_meter') {
    display = '等待音频数据';
    hint = lastMeterAt === null ? '尚未收到 OBS 电平数据' : '音频电平链路已中断';
  } else if (ready) {
    display = snapshot.audioSpeaking || snapshot.silentForSeconds < 3 ? '正在讲话' : `${snapshot.silentForSeconds}s`;
    hint = snapshot.audioSpeaking || snapshot.silentForSeconds < 3
      ? '音频正常'
      : `${Math.max(0, AUDIO_ALERT_SECONDS - snapshot.silentForSeconds)}s 后报警`;
  }

  return {
    ready,
    phase,
    tone: audioTone,
    inputName: snapshot.activeInputName || snapshot.config.targetInputNames.join('、') || snapshot.config.targetInputName,
    levelDb: hasFreshMeter ? snapshot.lastLevelDb : null,
    thresholdDb: snapshot.config.silenceThresholdDb,
    silenceDurationSeconds: AUDIO_ALERT_SECONDS,
    silentForSeconds: ready ? snapshot.silentForSeconds : 0,
    warningProgress: ready ? visual.warningProgress : 0,
    dangerProgress: ready ? visual.dangerProgress : 0,
    display,
    hint,
    lastMeterReceivedAt: lastMeterAt,
    meterAgeMs
  };
}

function remoteTelemetry(
  snapshot: AppSnapshot,
  update: UpdateSnapshot | null,
  identity: { version: string; platform: string; arch: string; osRelease: string; mobileAccessEnabled: boolean },
  latestRuntimeError: RuntimeErrorSummary | null = null
) {
  const recentError = recentRuntimeError(latestRuntimeError);
  return {
    timestamp: Date.now(),
    desktopOnline: true,
    audio: remoteAudioTelemetry(snapshot),
    atem: {
      connected: snapshot.atemConnected, programInput: snapshot.atemProgramInput, previewInput: snapshot.atemPreviewInput,
      inputIds: snapshot.atemInputIds, inputLabels: snapshot.atemInputLabels,
      inputMeta: Object.fromEntries(snapshot.atemInputIds.map((inputId) => {
        const custom = snapshot.config.atemInputCustomizations[String(inputId)];
        return [inputId, { color: custom?.color || defaultATEMInputColor(inputId), group: custom?.group || '未分组' }];
      })),
      elapsedSeconds: snapshot.atemProgramInputElapsedSeconds,
      limitSeconds: CAMERA_ALERT_SECONDS,
      overLimit: snapshot.atemProgramInputOverLimit,
      exempt: snapshot.atemProgramInputExempt,
      warningProgress: snapshot.atemProgramInputExempt
        ? 0
        : reminderVisualState(snapshot.atemProgramInputElapsedSeconds, CAMERA_ALERT_SECONDS).warningProgress,
      dangerProgress: snapshot.atemProgramInputExempt
        ? 0
        : reminderVisualState(snapshot.atemProgramInputElapsedSeconds, CAMERA_ALERT_SECONDS).dangerProgress,
      recentSwitches: snapshot.atemSwitchHistory.slice(0, 20),
      currentSession: snapshot.atemCurrentSession,
      recentSessions: snapshot.atemRecentSessions
    },
    obs: {
      connected: snapshot.connected, streaming: snapshot.streaming, recording: snapshot.recording,
      simulatedLive: snapshot.simulatedLive, virtualCameraActive: snapshot.virtualCameraActive,
      monitoringActive: snapshot.monitoringActive,
      liveActive: snapshot.streaming || snapshot.recording || snapshot.simulatedLive || snapshot.virtualCameraActive,
      fps: snapshot.obsStats.activeFps, cpu: snapshot.obsStats.cpuUsage, bitrateKbps: snapshot.obsStats.streamBitrateKbps
    },
    app: {
      version: identity.version,
      platform: identity.platform,
      arch: identity.arch,
      osRelease: identity.osRelease,
      mobileAccessEnabled: identity.mobileAccessEnabled,
      paused: !snapshot.monitoringActive,
      autoUpdateEnabled: snapshot.config.autoUpdateEnabled,
      updateStatus: update?.status ?? 'idle',
      updateCurrentVersion: update?.currentVersion ?? identity.version,
      updateAvailableVersion: update?.availableVersion ?? null,
      updateDownloadedVersion: update?.downloadedVersion ?? null,
      updateSourceLabel: update?.sourceLabel ?? null,
      updateLastCheckedAt: update?.lastCheckedAt ?? null,
      updateMessage: update?.message ?? null
    },
    service: {
      routeType: snapshot.remoteAccessRouteType,
      latencyMs: snapshot.remoteAccessLatencyMs,
      onlineMobileClients: snapshot.remoteAccessOnlineMobileClients,
      lastSyncAt: snapshot.remoteAccessLastSyncAt
    },
    diagnostics: {
      latestError: recentError
    }
  };
}

export function recentRuntimeError(
  summary: RuntimeErrorSummary | null,
  now = Date.now()
): RuntimeErrorSummary | null {
  if (!summary || !Number.isFinite(summary.occurredAt) || now - summary.occurredAt > RUNTIME_ERROR_MAX_AGE_MS) {
    return null;
  }
  return { ...summary };
}

function isRemoteAdminCommand(value: unknown): value is RemoteAdminCommand {
  return [
    'show_app',
    'reconnect_obs',
    'reconnect_atem',
    'check_update',
    'pause_monitoring',
    'resume_monitoring'
  ].includes(String(value));
}
