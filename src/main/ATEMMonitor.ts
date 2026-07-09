import { EventEmitter } from 'node:events';
import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { Atem, AtemConnectionStatus } from 'atem-connection';
import type { AtemState } from 'atem-connection';
import type { ATEMDiscoveredDevice, ATEMScanResult, ATEMStateSnapshot, ATEMTestResult } from '../shared/types.js';

export type ATEMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const ATEM_PORT = 9910;
const CONNECT_TIMEOUT_MS = 4200;
const DISCOVERY_TIMEOUT_MS = 1600;
const ATEM_HELLO_PACKET = Buffer.from([
  0x10, 0x14, 0x53, 0xab, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3a,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

interface CandidateHost {
  host: string;
  interfaceName?: string;
  network?: string;
}

interface ATEMMonitorEvents {
  stateChanged: [ATEMStateSnapshot];
}

export class ATEMMonitor extends EventEmitter<ATEMMonitorEvents> {
  private atem: Atem | null = null;
  private host = '';
  private enabled = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastState: ATEMStateSnapshot = this.emptyState();
  private connectionState: ATEMConnectionState = 'disconnected';

  get enabledState(): boolean {
    return this.enabled;
  }

  get currentHost(): string {
    return this.host;
  }

  get currentConnectionState(): ATEMConnectionState {
    return this.connectionState;
  }

  getSnapshot(): ATEMStateSnapshot {
    return { ...this.lastState };
  }

  async setConfig(enabled: boolean, host: string): Promise<ATEMStateSnapshot> {
    const hostChanged = this.host !== host;
    const enabledChanged = this.enabled !== enabled;
    this.enabled = enabled;
    this.host = host;

    if (!enabled) {
      await this.disconnect();
      this.connectionState = 'disconnected';
      this.lastState = this.emptyState();
      this.emitState();
      return this.getSnapshot();
    }

    if (hostChanged || enabledChanged) {
      await this.connect();
    }

    return this.getSnapshot();
  }

  async connect(): Promise<ATEMStateSnapshot> {
    this.clearReconnect();
    await this.disconnect();

    if (!this.enabled || !this.host) {
      return this.getSnapshot();
    }

    this.connectionState = 'connecting';
    this.lastState = {
      ...this.emptyState(),
      connectionState: 'connecting',
      errorMessage: null
    };
    this.emitState();

    const atem = this.createAtem(true);
    this.atem = atem;

    atem.on('connected', () => {
      console.log(`[ATEM] connected to ${this.host}`);
      this.connectionState = 'connected';
      this.lastState = {
        ...this.lastState,
        connectionState: 'connected',
        connected: true,
        errorMessage: null
      };
      this.emitState();
    });

    atem.on('disconnected', () => {
      console.log('[ATEM] disconnected');
      this.connectionState = 'disconnected';
      this.lastState = {
        ...this.lastState,
        connectionState: 'disconnected',
        connected: false
      };
      this.emitState();
      this.scheduleReconnect();
    });

    atem.on('stateChanged', (state: AtemState) => {
      this.updateStateFromATEM(state);
    });

    try {
      await atem.connect(this.host);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ATEM] connection failed: ${message}`);
      this.connectionState = 'error';
      this.lastState = {
        ...this.emptyState(),
        connectionState: 'error',
        errorMessage: `连接失败：${message}`
      };
      this.emitState();
      this.scheduleReconnect();
    }

    return this.getSnapshot();
  }

  async disconnect(): Promise<void> {
    this.clearReconnect();

    if (!this.atem) {
      return;
    }

    const atem = this.atem;
    this.atem = null;
    atem.removeAllListeners();

    try {
      await atem.disconnect();
    } catch {
      // Already disconnected.
    }

    this.connectionState = 'disconnected';
    this.lastState = this.emptyState();
    this.emitState();
  }

  async testConnection(host: string): Promise<ATEMTestResult> {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      return {
        ok: false,
        message: '请输入有效的 ATEM IP 地址',
        inputCount: 0
      };
    }

    let atem: Atem | null = null;
    try {
      atem = await this.connectTemporary(normalizedHost, CONNECT_TIMEOUT_MS);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : `无法连接 ATEM (${normalizedHost})`,
        inputCount: 0
      };
    }

    try {
      const state = atem.state;
      const inputCount = state && state.inputs
        ? Object.values(state.inputs).filter(Boolean).length
        : 0;
      const modelName = state?.info?.productIdentifier ?? undefined;

      return {
        ok: true,
        message: modelName
          ? `连接成功！检测到 ${modelName}，共 ${inputCount} 路输入`
          : `连接成功！检测到 ${inputCount} 路输入`,
        inputCount,
        modelName
      };
    } catch (error) {
      return {
        ok: true,
        message: '已连接 ATEM，但无法读取设备信息',
        inputCount: 0
      };
    } finally {
      try {
        await atem.destroy();
      } catch {
        // Temporary test connection closed.
      }
    }
  }

  async scanNetwork(seedHost?: string): Promise<ATEMScanResult> {
    const candidates = this.buildCandidateHosts(seedHost || this.host);
    if (candidates.length === 0) {
      return {
        ok: false,
        message: '没有找到可扫描的本机 IPv4 网段。请确认电脑已连接到和 ATEM 相同的局域网。',
        scannedHosts: 0,
        interfaces: [],
        devices: []
      };
    }

    let foundHosts: CandidateHost[];
    try {
      foundHosts = await this.probeATEMHosts(candidates, DISCOVERY_TIMEOUT_MS);
    } catch (error) {
      return {
        ok: false,
        message: `扫描失败：${error instanceof Error ? error.message : String(error)}`,
        scannedHosts: candidates.length,
        interfaces: Array.from(new Set(candidates.map((candidate) => candidate.interfaceName).filter(Boolean))) as string[],
        devices: []
      };
    }
    const devices: ATEMDiscoveredDevice[] = [];

    for (const candidate of foundHosts) {
      const result = await this.testConnection(candidate.host);
      devices.push({
        host: candidate.host,
        label: result.modelName ? `${result.modelName} (${candidate.host})` : `ATEM ${candidate.host}`,
        inputCount: result.inputCount,
        modelName: result.modelName,
        interfaceName: candidate.interfaceName,
        network: candidate.network,
        message: result.message
      });
    }

    devices.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
    const interfaces = Array.from(new Set(candidates.map((candidate) => candidate.interfaceName).filter(Boolean))) as string[];

    return {
      ok: devices.length > 0,
      message: devices.length > 0
        ? `找到 ${devices.length} 台疑似 ATEM 导播台`
        : `已扫描 ${candidates.length} 个地址，暂未发现 ATEM。请确认导播台与电脑在同一网段，且未被防火墙拦截。`,
      scannedHosts: candidates.length,
      interfaces,
      devices
    };
  }

  async changePreviewInput(input: number): Promise<void> {
    if (!this.atem || this.atem.status !== AtemConnectionStatus.CONNECTED) {
      console.warn('[ATEM] cannot change preview: not connected');
      return;
    }

    try {
      await this.atem.changePreviewInput(input);
    } catch (error) {
      console.error(`[ATEM] changePreviewInput failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async changeProgramInput(input: number): Promise<void> {
    if (!this.atem || this.atem.status !== AtemConnectionStatus.CONNECTED) {
      console.warn('[ATEM] cannot change program: not connected');
      return;
    }

    try {
      await this.atem.changeProgramInput(input);
    } catch (error) {
      console.error(`[ATEM] changeProgramInput failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async autoTransition(): Promise<void> {
    if (!this.atem || this.atem.status !== AtemConnectionStatus.CONNECTED) {
      console.warn('[ATEM] cannot auto transition: not connected');
      return;
    }

    try {
      await this.atem.autoTransition();
    } catch (error) {
      console.error(`[ATEM] autoTransition failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  private updateStateFromATEM(state: AtemState): void {
    const mixEffect = state.video?.mixEffects?.[0];
    const programInput = mixEffect?.programInput ?? 0;
    const previewInput = mixEffect?.previewInput ?? 0;

    const inputLabels: Record<number, string> = {};
    let inputCount = 0;

    if (state.inputs) {
      for (const [key, input] of Object.entries(state.inputs)) {
        const inputId = Number(key);
        if (input) {
          inputCount++;
          inputLabels[inputId] = input.longName || input.shortName || `Input ${inputId}`;
        }
      }
    }

    this.connectionState = 'connected';
    this.lastState = {
      connected: true,
      connectionState: 'connected',
      programInput,
      previewInput,
      inputLabels,
      inputCount,
      errorMessage: null
    };

    this.emitState();
  }

  private scheduleReconnect(): void {
    if (!this.enabled) {
      return;
    }

    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, 5000);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitState(): void {
    this.emit('stateChanged', this.getSnapshot());
  }

  private createAtem(trackState: boolean): Atem {
    const atem = new Atem({ childProcessTimeout: 1000 });
    atem.on('error', (message) => {
      console.warn(`[ATEM] ${message}`);
      if (!trackState) {
        return;
      }
      this.connectionState = 'error';
      this.lastState = {
        ...this.lastState,
        connected: false,
        connectionState: 'error',
        errorMessage: String(message)
      };
      this.emitState();
    });
    return atem;
  }

  private async connectTemporary(host: string, timeoutMs: number): Promise<Atem> {
    const atem = this.createAtem(false);
    let settled = false;

    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`连接 ${host} 超时，请确认 IP 正确且设备在线`));
      }, timeoutMs);

      atem.once('connected', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });

      atem.once('disconnected', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`ATEM ${host} 已断开连接`));
      });

      atem.once('error', (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(String(message)));
      });
    });

    try {
      await atem.connect(host, ATEM_PORT);
      await connected;
      return atem;
    } catch (error) {
      try {
        await atem.destroy();
      } catch {
        // Temporary connection already closed.
      }
      throw error;
    }
  }

  private buildCandidateHosts(seedHost?: string): CandidateHost[] {
    const candidates = new Map<string, CandidateHost>();
    const add = (host: string, interfaceName?: string, network?: string) => {
      const normalized = normalizeHost(host);
      if (!normalized || candidates.has(normalized)) return;
      candidates.set(normalized, { host: normalized, interfaceName, network });
    };

    add(seedHost || '', '当前设置', '手动地址');

    const interfaces = networkInterfaces();
    for (const [name, entries] of Object.entries(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        const parts = entry.address.split('.').map(Number);
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) continue;
        const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
        const network = `${prefix}.0/24`;
        const label = name || entry.address;
        const priorityHosts = [240, 1, 2, 10, 20, 50, 100, 101, 120, 200, 254];

        for (const suffix of priorityHosts) {
          add(`${prefix}.${suffix}`, label, network);
        }
        for (let suffix = 1; suffix <= 254; suffix++) {
          add(`${prefix}.${suffix}`, label, network);
        }
      }
    }

    return Array.from(candidates.values());
  }

  private async probeATEMHosts(candidates: CandidateHost[], timeoutMs: number): Promise<CandidateHost[]> {
    const byHost = new Map(candidates.map((candidate) => [candidate.host, candidate]));
    const found = new Map<string, CandidateHost>();
    const socket = createSocket('udp4');

    await bindSocket(socket);
    socket.on('error', (error) => {
      console.warn(`[ATEM] discovery socket error: ${error.message}`);
    });

    socket.on('message', (packet, remote) => {
      if (remote.port !== ATEM_PORT || packet.length < 12) return;
      const candidate = byHost.get(remote.address);
      if (candidate) {
        found.set(remote.address, candidate);
      }
    });

    for (const candidate of candidates) {
      socket.send(ATEM_HELLO_PACKET, ATEM_PORT, candidate.host, () => undefined);
    }

    await delay(timeoutMs);
    socket.close();
    return Array.from(found.values());
  }

  private emptyState(): ATEMStateSnapshot {
    return {
      connected: false,
      connectionState: 'disconnected',
      programInput: 0,
      previewInput: 0,
      inputLabels: {},
      inputCount: 0,
      errorMessage: null
    };
  }
}

function normalizeHost(value: string): string {
  const host = value.trim();
  const parts = host.split('.');
  if (parts.length !== 4) return '';
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return '';
    const num = Number(part);
    if (num < 0 || num > 255) return '';
  }
  return host;
}

function bindSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      socket.off('error', onError);
      resolve();
    };
    socket.once('error', onError);
    socket.once('listening', onListening);
    socket.bind(0);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
