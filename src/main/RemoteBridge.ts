import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import WebSocket from 'ws';
import type { AppConfig, AppSnapshot, RemoteAccessSnapshot } from '../shared/types.js';

export interface RemoteCommand {
  id: string;
  command: 'atem.preview' | 'atem.auto';
  payload: Record<string, unknown>;
}

interface RemoteBridgeEvents {
  stateChanged: [RemoteAccessSnapshot];
  command: [RemoteCommand];
}

const SEND_INTERVAL_MS = 400;

export class RemoteBridge extends EventEmitter<RemoteBridgeEvents> {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sendTimer: NodeJS.Timeout | null = null;
  private latestSnapshot: AppSnapshot | null = null;
  private enabled = false;
  private serverUrl = '';
  private uuid = '';
  private secret = '';
  private generation = 0;
  private state: RemoteAccessSnapshot = {
    connectionState: 'disabled', connected: false, pairUrl: null, errorMessage: null, lastConnectedAt: null
  };

  static createDeviceIdentity(): { uuid: string; secret: string } {
    return { uuid: randomUUID(), secret: randomBytes(32).toString('hex') };
  }

  getSnapshot(): RemoteAccessSnapshot {
    return { ...this.state };
  }

  async configure(config: AppConfig): Promise<void> {
    const normalizedUrl = normalizeServerUrl(config.remoteServerUrl);
    const changed = this.enabled !== config.remoteAccessEnabled || this.serverUrl !== normalizedUrl || this.uuid !== config.remoteDeviceUuid || this.secret !== config.remoteDeviceSecret;
    this.enabled = config.remoteAccessEnabled;
    this.serverUrl = normalizedUrl;
    this.uuid = config.remoteDeviceUuid;
    this.secret = config.remoteDeviceSecret;
    if (!changed) return;
    this.generation += 1;
    this.clearTimers();
    this.closeSocket();
    if (!this.enabled) {
      this.setState({ connectionState: 'disabled', connected: false, pairUrl: null, errorMessage: null });
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

  sendCommandResult(id: string, ok: boolean, message: string): void {
    this.send({ type: 'command-result', id, ok, message });
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.generation += 1;
    this.clearTimers();
    this.closeSocket();
  }

  private async connect(generation: number): Promise<void> {
    if (!this.enabled || generation !== this.generation) return;
    if (!this.serverUrl || !this.uuid || this.secret.length < 32) {
      this.setState({ connectionState: 'error', connected: false, errorMessage: '远程访问配置无效' });
      return;
    }
    this.setState({ connectionState: 'connecting', connected: false, errorMessage: null });
    try {
      const response = await fetch(`${this.serverUrl}/api/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: this.uuid, secret: this.secret, label: hostname() }),
        signal: AbortSignal.timeout(8000)
      });
      const body = await response.json() as { device?: { pairUrl?: string }; error?: string };
      if (!response.ok || !body.device?.pairUrl) throw new Error(body.error || `服务器返回 ${response.status}`);
      if (!this.enabled || generation !== this.generation) return;
      this.state.pairUrl = body.device.pairUrl;
      this.openSocket(generation);
    } catch (error) {
      if (!this.enabled || generation !== this.generation) return;
      this.setState({ connectionState: 'error', connected: false, errorMessage: friendlyError(error) });
      this.scheduleReconnect(generation);
    }
  }

  private openSocket(generation: number): void {
    const wsUrl = new URL(this.serverUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.pathname = '/ws/desktop';
    wsUrl.search = new URLSearchParams({ uuid: this.uuid, secret: this.secret }).toString();
    const socket = new WebSocket(wsUrl);
    this.socket = socket;
    socket.on('open', () => {
      if (socket !== this.socket || generation !== this.generation) return;
      this.setState({ connectionState: 'connected', connected: true, errorMessage: null, lastConnectedAt: Date.now() });
      this.sendState();
    });
    socket.on('message', (raw) => {
      if (socket !== this.socket || generation !== this.generation) return;
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; pairUrl?: string; id?: string; command?: string; payload?: Record<string, unknown> };
        if (message.type === 'registered' && message.pairUrl) {
          this.setState({ pairUrl: message.pairUrl });
        } else if (message.type === 'command' && message.id && (message.command === 'atem.preview' || message.command === 'atem.auto')) {
          this.emit('command', { id: message.id, command: message.command, payload: message.payload ?? {} });
        }
      } catch {
        // Ignore malformed server messages.
      }
    });
    socket.on('close', () => {
      if (socket !== this.socket || generation !== this.generation) return;
      this.socket = null;
      this.setState({ connectionState: 'error', connected: false, errorMessage: '远程服务连接已断开，正在重试' });
      this.scheduleReconnect(generation);
    });
    socket.on('error', () => {
      // The close event owns retry and user-facing state.
    });
  }

  private sendState(): void {
    if (!this.latestSnapshot) return;
    this.send({ type: 'state', state: remoteTelemetry(this.latestSnapshot) });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private setState(patch: Partial<RemoteAccessSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit('stateChanged', this.getSnapshot());
  }

  private scheduleReconnect(generation: number): void {
    if (!this.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(generation);
    }, 5000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.reconnectTimer = null;
    this.sendTimer = null;
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

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return '连接远程服务超时';
  if (/fetch|connect|refused|network/i.test(message)) return '无法连接远程服务，请检查服务器地址和网络';
  return message || '远程服务连接失败';
}

function remoteTelemetry(snapshot: AppSnapshot) {
  const level = snapshot.lastLevelDb;
  const audioTone = snapshot.alertVisible ? 'danger' : snapshot.silentForSeconds >= snapshot.config.silenceDurationSeconds * 0.75 ? 'warning' : 'safe';
  return {
    timestamp: Date.now(),
    desktopOnline: true,
    audio: {
      ready: snapshot.readinessReason === 'ready', tone: audioTone,
      inputName: snapshot.activeInputName || snapshot.config.targetInputNames.join('、') || snapshot.config.targetInputName,
      levelDb: level, thresholdDb: snapshot.config.silenceThresholdDb,
      silentForSeconds: snapshot.silentForSeconds,
      display: snapshot.silentForSeconds < 3 ? '正在讲话' : `${snapshot.silentForSeconds}s`,
      hint: snapshot.silentForSeconds < 3 ? '音频正常' : `${Math.max(0, snapshot.config.silenceDurationSeconds - snapshot.silentForSeconds)}s 后报警`
    },
    atem: {
      connected: snapshot.atemConnected, programInput: snapshot.atemProgramInput, previewInput: snapshot.atemPreviewInput,
      inputIds: snapshot.atemInputIds, inputLabels: snapshot.atemInputLabels,
      elapsedSeconds: snapshot.atemProgramInputElapsedSeconds,
      limitSeconds: snapshot.config.atemCameraTimeLimitSeconds,
      overLimit: snapshot.atemProgramInputOverLimit
    },
    obs: {
      connected: snapshot.connected, streaming: snapshot.streaming, recording: snapshot.recording,
      fps: snapshot.obsStats.activeFps, cpu: snapshot.obsStats.cpuUsage, bitrateKbps: snapshot.obsStats.streamBitrateKbps
    }
  };
}
