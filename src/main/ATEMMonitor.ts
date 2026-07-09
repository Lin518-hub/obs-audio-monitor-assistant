import { EventEmitter } from 'node:events';
import { Atem, AtemConnectionStatus } from 'atem-connection';
import type { AtemState } from 'atem-connection';
import type { ATEMStateSnapshot, ATEMTestResult } from '../shared/types.js';

export type ATEMConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

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

    const atem = new Atem();
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
    const atem = new Atem();

    try {
      await atem.connect(host);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : `无法连接 ATEM (${host})`,
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
        await atem.disconnect();
      } catch {
        // Temporary test connection closed.
      }
    }
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
