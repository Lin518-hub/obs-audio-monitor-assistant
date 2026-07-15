import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { Atem, AtemConnectionStatus, Enums } from 'atem-connection';
import type { AtemState } from 'atem-connection';
import type { ATEMDiscoveredDevice, ATEMScanResult, ATEMStateSnapshot, ATEMSwitchHistoryEntry, ATEMTestResult } from '../shared/types.js';
import { reconnectBackoffDelay } from '../shared/reconnect.js';

export type ATEMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const ATEM_PORT = 9910;
// The library waits up to five seconds for the UDP handshake by itself. Keep
// this timeout longer so a healthy but busy ATEM is not destroyed by us first.
const CONNECT_TIMEOUT_MS = 9000;
const DISCOVERY_TIMEOUT_MS = 2200;
const DISCOVERY_DIRECT_TIMEOUT_MS = 5200;
const execFileAsync = promisify(execFile);
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
  switchRecorded: [ATEMSwitchHistoryEntry];
}

export class ATEMMonitor extends EventEmitter<ATEMMonitorEvents> {
  private atem: Atem | null = null;
  private host = '';
  private enabled = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private elapsedTicker: NodeJS.Timeout | null = null;
  private lastState: ATEMStateSnapshot = this.emptyState();
  private connectionState: ATEMConnectionState = 'disconnected';
  private connectionGeneration = 0;
  private programInputStartedAt: number | null = null;
  private cameraTimeLimitSeconds = 600;
  private reconnectAttempt = 0;
  private nextReconnectAt: number | null = null;

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
    const elapsedSeconds = this.programInputStartedAt
      ? Math.max(0, Math.floor((Date.now() - this.programInputStartedAt) / 1000))
      : 0;
    return {
      ...this.lastState,
      programInputStartedAt: this.programInputStartedAt,
      programInputElapsedSeconds: elapsedSeconds,
      programInputOverLimit: this.programInputStartedAt !== null && elapsedSeconds >= this.cameraTimeLimitSeconds,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt
    };
  }

  async setConfig(enabled: boolean, host: string, cameraTimeLimitSeconds = 600): Promise<ATEMStateSnapshot> {
    const normalizedHost = normalizeHost(host);
    const hostChanged = this.host !== normalizedHost;
    const enabledChanged = this.enabled !== enabled;
    this.enabled = enabled;
    this.host = normalizedHost;
    this.cameraTimeLimitSeconds = Math.max(10, Math.round(cameraTimeLimitSeconds));

    if (!enabled) {
      await this.disconnect();
      this.connectionState = 'disconnected';
      this.programInputStartedAt = null;
      this.clearElapsedTicker();
      this.lastState = this.emptyState();
      this.emitState();
      return this.getSnapshot();
    }

    if (hostChanged || enabledChanged) {
      await this.connect(true);
    }

    return this.getSnapshot();
  }

  async connect(manual = true): Promise<ATEMStateSnapshot> {
    if (manual) this.reconnectAttempt = 0;
    const generation = ++this.connectionGeneration;
    this.clearReconnect();
    await this.closeCurrentConnection();

    if (!this.enabled) {
      this.connectionState = 'disconnected';
      this.programInputStartedAt = null;
      this.lastState = this.emptyState();
      this.emitState();
      return this.getSnapshot();
    }

    if (!this.host) {
      this.connectionState = 'error';
      this.programInputStartedAt = null;
      this.lastState = {
        ...this.emptyState(),
        connectionState: 'error',
        errorMessage: '请输入有效的 ATEM IP 地址'
      };
      this.emitState();
      return this.getSnapshot();
    }

    if (generation !== this.connectionGeneration) {
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
    const isCurrentConnection = () => this.atem === atem && this.connectionGeneration === generation;

    atem.on('connected', () => {
      if (!isCurrentConnection()) return;
      console.log(`[ATEM] connected to ${this.host}`);
      this.reconnectAttempt = 0;
      this.nextReconnectAt = null;
      this.connectionState = 'connected';
      this.lastState = {
        ...this.lastState,
        connectionState: 'connected',
        connected: true,
        errorMessage: null
      };
      this.emitState();

      // The protocol reports "connected" before the initial state transfer is
      // necessarily complete. Re-read the in-memory state a few times so the
      // current PGM/PVW and input list appear without requiring a page switch.
      for (const delayMs of [0, 160, 600, 1400]) {
        setTimeout(() => {
          if (!isCurrentConnection() || !atem.state) return;
          this.updateStateFromATEM(atem.state);
        }, delayMs);
      }
    });

    atem.on('disconnected', () => {
      if (!isCurrentConnection()) return;
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
      if (!isCurrentConnection()) return;
      this.updateStateFromATEM(state);
    });

    try {
      await atem.connect(this.host, ATEM_PORT);
    } catch (error) {
      if (!isCurrentConnection()) {
        return this.getSnapshot();
      }
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
    this.connectionGeneration += 1;
    this.clearReconnect();
    await this.closeCurrentConnection();

    this.connectionState = 'disconnected';
    this.programInputStartedAt = null;
    this.clearElapsedTicker();
    this.lastState = this.emptyState();
    this.emitState();
  }

  private async closeCurrentConnection(): Promise<void> {

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

    if (normalizedHost === this.host && this.lastState.connected) {
      const current = this.getSnapshot();
      return {
        ok: true,
        message: current.modelName
          ? `已连接 ${current.modelName}，可用信号源 ${current.inputCount} 路`
          : `ATEM 已连接，可用信号源 ${current.inputCount} 路`,
        inputCount: current.inputCount,
        modelName: current.modelName ?? undefined
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
      const inputCount = state ? usableATEMInputs(state).inputIds.length : 0;
      const modelName = state?.info?.productIdentifier ?? undefined;

      return {
        ok: true,
        message: modelName
          ? `连接成功！检测到 ${modelName}，可用信号源 ${inputCount} 路`
          : `连接成功！检测到可用信号源 ${inputCount} 路`,
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
    const normalizedSeed = normalizeHost(seedHost || this.host);
    const candidates = this.buildCandidateHosts(normalizedSeed);
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
    // Some ATEM firmware accepts the normal connection handshake but does not
    // answer the lightweight discovery packet. Always verify the manually
    // entered address directly so “查找导播台” does not hide a usable device.
    const connectedSeed = normalizedSeed && normalizedSeed === this.host && this.lastState.connected
      ? this.getSnapshot()
      : null;
    if (connectedSeed) {
      const seedCandidate = candidates.find((candidate) => candidate.host === normalizedSeed);
      if (seedCandidate && !foundHosts.some((candidate) => candidate.host === normalizedSeed)) {
        foundHosts = [seedCandidate, ...foundHosts];
      }
    } else if (normalizedSeed) {
      const seedCandidate = candidates.find((candidate) => candidate.host === normalizedSeed);
      if (seedCandidate && !foundHosts.some((candidate) => candidate.host === normalizedSeed)) {
        const directResult = await this.testConnection(normalizedSeed);
        if (directResult.ok) {
          foundHosts = [seedCandidate, ...foundHosts];
        }
      }
    }

    const devices: ATEMDiscoveredDevice[] = [];

    for (const candidate of foundHosts) {
      if (connectedSeed && candidate.host === normalizedSeed) {
        devices.push({
          host: candidate.host,
          label: connectedSeed.modelName ? `${connectedSeed.modelName} (${candidate.host})` : `已连接 ATEM (${candidate.host})`,
          inputCount: connectedSeed.inputCount,
          modelName: connectedSeed.modelName ?? undefined,
          interfaceName: candidate.interfaceName,
          network: candidate.network,
          message: `已连接，可用信号源 ${connectedSeed.inputCount} 路`
        });
        continue;
      }
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
    const atem = this.requireConnected('选择预览信号');
    if (!Number.isInteger(input) || input <= 0 || !this.lastState.inputIds.includes(input)) {
      throw new Error('目标预览信号不可用');
    }

    try {
      await atem.changePreviewInput(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ATEM] changePreviewInput failed: ${message}`);
      throw new Error(`选择 PVW 失败：${message}`);
    }
  }

  async changeProgramInput(input: number): Promise<void> {
    const atem = this.requireConnected('执行硬切');
    if (!Number.isInteger(input) || input <= 0 || !this.lastState.inputIds.includes(input)) {
      throw new Error('目标播出信号不可用');
    }

    try {
      await atem.changeProgramInput(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ATEM] changeProgramInput failed: ${message}`);
      throw new Error(`硬切失败：${message}`);
    }
  }

  async autoTransition(): Promise<void> {
    const atem = this.requireConnected('执行 AUTO 切换');
    if (this.lastState.previewInput <= 0) throw new Error('当前没有可切换的 PVW 信号');

    try {
      await atem.autoTransition();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ATEM] autoTransition failed: ${message}`);
      throw new Error(`AUTO 切换失败：${message}`);
    }
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  private updateStateFromATEM(state: AtemState): void {
    const mixEffect = state.video?.mixEffects?.[0];
    const programInput = mixEffect?.programInput ?? 0;
    const previewInput = mixEffect?.previewInput ?? 0;

    const { inputIds, inputLabels } = usableATEMInputs(state);

    const now = Date.now();
    const previousProgramInput = this.lastState.programInput;
    if (programInput > 0 && previousProgramInput > 0 && programInput !== previousProgramInput && this.programInputStartedAt !== null) {
      this.emit('switchRecorded', {
        id: `${now}-${previousProgramInput}-${programInput}-${Math.random().toString(36).slice(2, 8)}`,
        switchedAt: now,
        fromInputId: previousProgramInput,
        fromInputLabel: this.lastState.inputLabels[previousProgramInput] || `Input ${previousProgramInput}`,
        toInputId: programInput,
        toInputLabel: inputLabels[programInput] || `Input ${programInput}`,
        startedAt: this.programInputStartedAt,
        durationSeconds: Math.max(0, Math.floor((now - this.programInputStartedAt) / 1000))
      });
    }

    if (programInput <= 0) {
      // 0 means that no usable PGM input is active. It must not start a
      // camera timer, otherwise an idle switcher can eventually be reported
      // as an over-time camera.
      this.programInputStartedAt = null;
    } else if (programInput !== this.lastState.programInput || this.programInputStartedAt === null) {
      this.programInputStartedAt = now;
    }

    this.connectionState = 'connected';
    this.lastState = {
      connected: true,
      connectionState: 'connected',
      modelName: state.info?.productIdentifier ?? null,
      programInput,
      previewInput,
      inputIds,
      inputLabels,
      inputCount: inputIds.length,
      programInputStartedAt: this.programInputStartedAt,
      programInputElapsedSeconds: this.programInputStartedAt
        ? Math.max(0, Math.floor((now - this.programInputStartedAt) / 1000))
        : 0,
      programInputOverLimit: this.programInputStartedAt
        ? now - this.programInputStartedAt >= this.cameraTimeLimitSeconds * 1000
        : false,
      errorMessage: null,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt
    };

    this.ensureElapsedTicker();
    this.emitState();
  }

  private scheduleReconnect(): void {
    if (!this.enabled) {
      return;
    }

    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = reconnectBackoffDelay(this.reconnectAttempt);
    this.nextReconnectAt = Date.now() + delay;
    this.emitState();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      void this.connect(false);
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextReconnectAt = null;
  }

  private ensureElapsedTicker(): void {
    if (this.elapsedTicker) return;
    this.elapsedTicker = setInterval(() => {
      if (this.connectionState === 'connected' && this.programInputStartedAt !== null) {
        this.emitState();
      }
    }, 1000);
  }

  private clearElapsedTicker(): void {
    if (!this.elapsedTicker) return;
    clearInterval(this.elapsedTicker);
    this.elapsedTicker = null;
  }

  private emitState(): void {
    this.emit('stateChanged', this.getSnapshot());
  }

  private requireConnected(action: string): Atem {
    if (!this.atem || this.atem.status !== AtemConnectionStatus.CONNECTED || !this.lastState.connected) {
      throw new Error(`ATEM 未连接，无法${action}`);
    }
    return this.atem;
  }

  private createAtem(trackState: boolean): Atem {
    // Initial ATEM state sync can legitimately take a few seconds on older
    // switchers. A one-second worker watchdog causes false disconnects.
    const atem = new Atem({ childProcessTimeout: 8000 });
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
    const seedNumber = seedHost ? ipv4ToNumber(seedHost) : null;
    if (seedNumber !== null) {
      const seedNetworkNumber = (seedNumber & 0xffffff00) >>> 0;
      const seedNetwork = `${numberToIPv4(seedNetworkNumber)}/24`;
      for (let suffix = 1; suffix <= 254; suffix += 1) {
        add(numberToIPv4(seedNetworkNumber + suffix), '当前设置网段', seedNetwork);
      }
    }

    const interfaces = networkInterfaces();
    for (const [name, entries] of Object.entries(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        const addressNumber = ipv4ToNumber(entry.address);
        const netmaskNumber = ipv4ToNumber(entry.netmask);
        if (addressNumber === null || netmaskNumber === null) continue;
        const networkNumber = (addressNumber & netmaskNumber) >>> 0;
        const prefixLength = countMaskBits(netmaskNumber);
        const hostCount = 2 ** (32 - prefixLength);
        if (hostCount <= 2) continue;
        const firstHost = networkNumber + 1;
        const lastHost = networkNumber + hostCount - 2;
        const network = `${numberToIPv4(networkNumber)}/${prefixLength}`;
        const label = name || entry.address;
        const preferredHosts = [1, 2, 10, 20, 50, 100, 101, 120, 200, 240, 254]
          .map((suffix) => networkNumber + suffix)
          .filter((candidate) => candidate >= firstHost && candidate <= lastHost);
        for (const candidate of preferredHosts) {
          add(numberToIPv4(candidate), label, network);
        }

        // Avoid flooding a large corporate network. A normal /24 is scanned
        // completely; larger networks are sampled evenly after the common
        // ATEM host addresses above have been checked.
        const scanLimit = 4096;
        const step = Math.max(1, Math.ceil((lastHost - firstHost + 1) / scanLimit));
        for (let candidate = firstHost; candidate <= lastHost; candidate += step) {
          add(numberToIPv4(candidate), label, network);
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
    socket.setBroadcast(true);
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

    // Sending thousands of UDP packets in one event-loop turn causes drops on
    // both macOS and Windows. Two paced passes are still quick on /24 networks
    // and are much more reliable with USB Ethernet adapters and Wi-Fi.
    const batchSize = 48;
    const broadcastHosts = Array.from(new Set(
      candidates
        .map((candidate) => candidate.network ? broadcastAddressForCidr(candidate.network) : null)
        .filter((host): host is string => Boolean(host))
    ));
    for (let pass = 0; pass < 2; pass += 1) {
      for (const broadcastHost of broadcastHosts) {
        socket.send(ATEM_HELLO_PACKET, ATEM_PORT, broadcastHost, () => undefined);
      }
      for (let offset = 0; offset < candidates.length; offset += batchSize) {
        for (const candidate of candidates.slice(offset, offset + batchSize)) {
          socket.send(ATEM_HELLO_PACKET, ATEM_PORT, candidate.host, () => undefined);
        }
        await delay(12);
      }
      await delay(120);
    }

    await delay(timeoutMs);
    socket.close();

    // Some switchers complete ARP resolution but do not answer our stateless
    // hello while another controller is connected. Verify only reachable ARP
    // neighbours with a short real ATEM handshake instead of opening hundreds
    // of expensive worker sessions for every address in the subnet.
    const arpHosts = await readArpHosts();
    const arpCandidates = arpHosts
      .map((host) => byHost.get(host))
      .filter((candidate): candidate is CandidateHost => Boolean(candidate))
      .filter((candidate) => !found.has(candidate.host))
      .slice(0, 128);

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(8, arpCandidates.length) }, async () => {
      while (nextIndex < arpCandidates.length) {
        const candidate = arpCandidates[nextIndex++];
        if (candidate.host === this.host && this.lastState.connected) {
          found.set(candidate.host, candidate);
          continue;
        }
        let temporary: Atem | null = null;
        try {
          temporary = await this.connectTemporary(candidate.host, DISCOVERY_DIRECT_TIMEOUT_MS);
          found.set(candidate.host, candidate);
        } catch {
          // Reachable network device, but not an ATEM.
        } finally {
          if (temporary) {
            try { await temporary.destroy(); } catch { /* already closed */ }
          }
        }
      }
    });
    await Promise.all(workers);
    return Array.from(found.values());
  }

  private emptyState(): ATEMStateSnapshot {
    return {
      connected: false,
      connectionState: 'disconnected',
      modelName: null,
      programInput: 0,
      previewInput: 0,
      inputIds: [],
      inputLabels: {},
      inputCount: 0,
      programInputStartedAt: null,
      programInputElapsedSeconds: 0,
      programInputOverLimit: false,
      errorMessage: null,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt
    };
  }
}

function usableATEMInputs(state: AtemState): { inputIds: number[]; inputLabels: Record<number, string> } {
  const inputLabels: Record<number, string> = {};
  const inputIds: number[] = [];

  for (const [key, input] of Object.entries(state.inputs ?? {})) {
    if (!input) continue;
    const inputId = Number(key);
    const isCamera = inputId >= 1 && inputId <= 8;
    const isUtilitySource = [
      Enums.InternalPortType.ColorBars,
      Enums.InternalPortType.ColorGenerator,
      Enums.InternalPortType.MediaPlayerFill
    ].includes(input.internalPortType);
    if (!isCamera && !isUtilitySource) continue;

    inputIds.push(inputId);
    inputLabels[inputId] = input.longName || input.shortName || defaultATEMInputLabel(inputId, input.internalPortType);
  }

  inputIds.sort((a, b) => {
    const aCamera = a >= 1 && a <= 8;
    const bCamera = b >= 1 && b <= 8;
    if (aCamera !== bCamera) return aCamera ? -1 : 1;
    return a - b;
  });
  return { inputIds, inputLabels };
}

function defaultATEMInputLabel(inputId: number, portType: Enums.InternalPortType): string {
  if (inputId >= 1 && inputId <= 8) return `CAM ${inputId}`;
  if (portType === Enums.InternalPortType.ColorBars) return '彩条';
  if (portType === Enums.InternalPortType.ColorGenerator) return 'Color';
  if (portType === Enums.InternalPortType.MediaPlayerFill) return 'Media Player';
  return `Input ${inputId}`;
}

function normalizeHost(value: string): string {
  const host = value.trim().replace(/^\[|\]$/g, '');
  const parts = host.split('.');
  if (parts.length !== 4) return '';
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return '';
    const num = Number(part);
    if (num < 0 || num > 255) return '';
  }
  return host;
}

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;
  return ((numbers[0] << 24) | (numbers[1] << 16) | (numbers[2] << 8) | numbers[3]) >>> 0;
}

function numberToIPv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.');
}

function countMaskBits(mask: number): number {
  let bits = 0;
  let value = mask >>> 0;
  while (value !== 0) {
    bits += value & 1;
    value >>>= 1;
  }
  return bits;
}

function broadcastAddressForCidr(value: string): string | null {
  const [address, prefixText] = value.split('/');
  const addressNumber = ipv4ToNumber(address);
  const prefix = Number(prefixText);
  if (addressNumber === null || !Number.isInteger(prefix) || prefix < 8 || prefix > 30) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return numberToIPv4(((addressNumber & mask) | (~mask >>> 0)) >>> 0);
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

async function readArpHosts(): Promise<string[]> {
  try {
    const args = process.platform === 'win32' ? ['-a'] : ['-an'];
    const { stdout } = await execFileAsync('arp', args, { timeout: 2500, maxBuffer: 1024 * 1024 });
    const hosts = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      if (/incomplete|failed/i.test(line)) continue;
      for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
        const host = normalizeHost(match[0]);
        if (host) hosts.add(host);
      }
    }
    return Array.from(hosts);
  } catch {
    return [];
  }
}
