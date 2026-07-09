import { EventEmitter } from 'node:events';
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { maxInputLevelDb } from '../shared/audio.js';
import { isProbablyAudibleInputKind } from '../shared/inputKinds.js';
import {
  deriveStatus,
  initialRuntimeState,
  isPreAlertVisible,
  preAlertRemainingSeconds,
  reducePreAlertDismiss,
  reduceAlertAction,
  reduceAudioLevel,
  reduceOutputState,
  secondsUntilAlert,
  silentForSeconds,
  type MonitorRuntimeState
} from '../shared/silenceState.js';
import type {
  AlertAction,
  AlertHistoryEntry,
  AppConfig,
  AppSnapshot,
  DisplayInfo,
  InputOption,
  ReadinessReason,
  TestConnectionResult
} from '../shared/types.js';

interface MonitorEvents {
  snapshot: [AppSnapshot];
  alert: [AppSnapshot];
}

type OBSInputVolumeMetersEvent = {
  inputs: Array<{
    inputName: string;
    inputLevelsMul: number[][];
  }>;
};

export class OBSMonitor extends EventEmitter<MonitorEvents> {
  private obs: OBSWebSocket | null = null;
  private config: AppConfig;
  private inputs: InputOption[] = [];
  private displays: DisplayInfo[] = [];
  private state: MonitorRuntimeState = initialRuntimeState;
  private errorMessage: string | null = null;
  private outputTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private testAlertRestore: { state: MonitorRuntimeState; errorMessage: string | null; inputs: InputOption[]; lastTargetMeterAt: number | null } | null = null;
  private history: AlertHistoryEntry[] = [];
  private lastTargetMeterAt: number | null = null;
  private simulatedLive = false;
  private actualStreaming = false;
  private actualRecording = false;

  constructor(config: AppConfig, displays: DisplayInfo[]) {
    super();
    this.config = config;
    this.displays = displays;
  }

  getSnapshot(now = Date.now()): AppSnapshot {
    const readinessReason = this.getReadinessReason(now);
    const status = readinessReason === 'error' ? 'error' : deriveStatus(this.state, this.config, now);
    const preAlertVisible = readinessReason === 'ready' && isPreAlertVisible(this.state, this.config, now);

    return {
      config: this.config,
      status,
      inputs: this.inputs,
      displays: this.displays,
      connected: this.state.connected,
      streaming: this.state.streaming,
      recording: this.state.recording,
      simulatedLive: this.simulatedLive,
      lastLevelDb: this.state.lastLevelDb,
      silentForSeconds: silentForSeconds(this.state, now),
      secondsUntilAlert: secondsUntilAlert(this.state, this.config, now),
      alertVisible: this.state.alertVisible,
      readinessReason,
      preAlertVisible,
      preAlertRemainingSeconds: preAlertVisible ? preAlertRemainingSeconds(this.state, this.config, now) : null,
      preAlertDismissed: this.state.silentSince !== null && this.state.preAlertDismissedSilentSince === this.state.silentSince,
      snoozedUntil: this.state.snoozedUntil,
      history: this.history,
      errorMessage: this.errorMessage,
      // ATEM 字段由 main.ts 的 injectATEMState() 注入，此处提供默认值
      atemConnected: false,
      atemConnectionState: 'disconnected',
      atemProgramInput: 0,
      atemPreviewInput: 0,
      atemInputLabels: {},
      atemInputCount: 0
    };
  }

  async start(): Promise<void> {
    this.startTicking();
    await this.connect();
  }

  async stop(): Promise<void> {
    this.clearTimers();
    await this.disconnect();
  }

  async updateConfig(patch: Partial<AppConfig>): Promise<AppSnapshot> {
    const previous = this.config;
    this.config = {
      ...this.config,
      ...patch
    };

    if (this.config.paused) {
      this.state = {
        ...this.state,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null
      };
    }

    if (previous.targetInputName !== this.config.targetInputName) {
      this.lastTargetMeterAt = null;
      this.state = {
        ...this.state,
        lastLevelDb: null,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null
      };
    }

    const connectionChanged =
      previous.obsHost !== this.config.obsHost ||
      previous.obsPort !== this.config.obsPort ||
      previous.obsPassword !== this.config.obsPassword;

    this.emitSnapshot();

    if (connectionChanged) {
      await this.connect();
    }

    return this.getSnapshot();
  }

  setDisplays(displays: DisplayInfo[]): void {
    this.displays = displays;
    this.emitSnapshot();
  }

  setHistory(history: AlertHistoryEntry[]): void {
    this.history = history;
    this.emitSnapshot();
  }

  resetTransientState(): AppSnapshot {
    this.testAlertRestore = null;
    this.errorMessage = null;
    this.lastTargetMeterAt = null;
    this.simulatedLive = false;
    const now = Date.now();
    const resetState: MonitorRuntimeState = {
      ...this.state,
      streaming: this.actualStreaming,
      recording: this.actualRecording,
      lastLevelDb: null,
      silentSince: null,
      alertVisible: false,
      preAlertDismissedSilentSince: null,
      snoozedUntil: null,
      ignoredUntilAudioReturns: false
    };
    this.state = {
      ...resetState,
      status: deriveStatus(resetState, this.config, now)
    };
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async reconnect(): Promise<AppSnapshot> {
    await this.connect();
    return this.getSnapshot();
  }

  async refreshInputs(): Promise<InputOption[]> {
    if (!this.obs || !this.state.connected) {
      return this.inputs;
    }

    try {
      await this.loadInputs();
      this.errorMessage = null;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : '刷新 OBS 输入源失败。';
      this.inputs = [];
    } finally {
      this.emitSnapshot();
    }

    return this.inputs;
  }

  handleAlertAction(action: AlertAction): AppSnapshot {
    if (this.testAlertRestore) {
      this.state = this.testAlertRestore.state;
      this.errorMessage = this.testAlertRestore.errorMessage;
      this.inputs = this.testAlertRestore.inputs;
      this.lastTargetMeterAt = this.testAlertRestore.lastTargetMeterAt;
      this.testAlertRestore = null;
      if (!this.state.connected) {
        this.scheduleReconnect();
      }
      this.emitSnapshot();
      return this.getSnapshot();
    }

    this.state = reduceAlertAction(this.state, this.config, action, Date.now());
    this.emitSnapshot();
    return this.getSnapshot();
  }

  dismissPreAlert(): AppSnapshot {
    this.state = reducePreAlertDismiss(this.state, this.config, Date.now());
    this.emitSnapshot();
    return this.getSnapshot();
  }

  isTestAlertActive(): boolean {
    return this.testAlertRestore !== null;
  }

  setSimulatedLive(enabled: boolean): AppSnapshot {
    this.simulatedLive = enabled;
    this.state = reduceOutputState(this.state, this.config, enabled || this.actualStreaming, this.actualRecording, Date.now());
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async testConnection(config: AppConfig): Promise<TestConnectionResult> {
    const obs = new OBSWebSocket();

    try {
      await obs.connect(`ws://${config.obsHost}:${config.obsPort}`, config.obsPassword || undefined, {
        eventSubscriptions: EventSubscription.None
      });
    } catch (error) {
      return {
        ok: false,
        stage: 'connect',
        message: error instanceof Error ? error.message : '无法连接 OBS WebSocket。',
        inputCount: 0
      };
    }

    try {
      const response = await obs.call('GetInputList');
      const audibleInputs = response.inputs.filter((input) => isProbablyAudibleInputKind(String(input.inputKind ?? '')));
      return {
        ok: true,
        stage: 'inputs',
        message: `连接成功，读取到 ${audibleInputs.length} 个可检测音频源。`,
        inputCount: audibleInputs.length
      };
    } catch (error) {
      return {
        ok: false,
        stage: 'inputs',
        message: error instanceof Error ? error.message : '已连接 OBS，但读取输入源失败。',
        inputCount: 0
      };
    } finally {
      try {
        await obs.disconnect();
      } catch {
        // Temporary test connection is already closed.
      }
    }
  }

  triggerTestAlert(): AppSnapshot {
    const now = Date.now();
    if (!this.testAlertRestore) {
      this.testAlertRestore = {
        state: this.state,
        errorMessage: this.errorMessage,
        inputs: this.inputs,
        lastTargetMeterAt: this.lastTargetMeterAt
      };
    }

    this.errorMessage = null;
    const targetInputName = this.config.targetInputName || '演示麦克风';
    if (!this.inputs.some((input) => input.inputName === targetInputName)) {
      this.inputs = [{ inputName: targetInputName, inputKind: 'demo_input' }, ...this.inputs];
    }

    this.state = {
      ...this.state,
      connected: true,
      streaming: true,
      recording: false,
      lastLevelDb: -100,
      silentSince: now - this.config.silenceDurationSeconds * 1000,
      alertVisible: true,
      preAlertDismissedSilentSince: null,
      snoozedUntil: null,
      ignoredUntilAudioReturns: false,
      status: 'alerting'
    };
    const snapshot = this.getSnapshot(now);
    this.emit('alert', snapshot);
    this.emit('snapshot', snapshot);
    return snapshot;
  }

  private async connect(): Promise<void> {
    this.clearReconnect();
    await this.disconnect();

    this.inputs = [];
    this.lastTargetMeterAt = null;
    this.errorMessage = null;
    this.state = this.unavailableState('connecting');
    this.emitSnapshot();

    const obs = new OBSWebSocket();
    this.obs = obs;
    obs.on('ConnectionClosed', () => {
      this.markDisconnected('OBS 连接已断开，正在等待重新连接。');
      this.scheduleReconnect();
    });
    obs.on('ConnectionError', (error) => {
      this.markDisconnected(error.message || 'OBS 连接失败。');
      this.scheduleReconnect();
    });
    obs.on('InputVolumeMeters', (event) => this.handleVolumeMeters(event as OBSInputVolumeMetersEvent));

    try {
      await obs.connect(`ws://${this.config.obsHost}:${this.config.obsPort}`, this.config.obsPassword || undefined, {
        eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters
      });
      this.state = {
        ...this.state,
        connected: true,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null
      };
      this.lastTargetMeterAt = null;
      this.errorMessage = null;
      await this.loadInputs();
      await this.pollOutputState();
      this.startOutputPolling();
      this.emitSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBS 连接失败。';
      await this.disconnect();
      this.markDisconnected(message);
      this.scheduleReconnect();
    }
  }

  private async disconnect(): Promise<void> {
    this.stopOutputPolling();

    if (!this.obs) {
      return;
    }

    const obs = this.obs;
    this.obs = null;
    obs.removeAllListeners();

    try {
      await obs.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private async loadInputs(): Promise<void> {
    if (!this.obs) {
      return;
    }

    const response = await this.obs.call('GetInputList');
    this.inputs = response.inputs
      .map((input) => ({
        inputName: String(input.inputName ?? ''),
        inputKind: String(input.inputKind ?? '')
      }))
      .filter((input) => input.inputName.length > 0)
      .filter((input) => isProbablyAudibleInputKind(input.inputKind));
  }

  private async pollOutputState(): Promise<void> {
    if (!this.obs || !this.state.connected) {
      return;
    }

    try {
      const [streamStatus, recordStatus] = await Promise.all([
        this.obs.call('GetStreamStatus'),
        this.obs.call('GetRecordStatus')
      ]);
      this.actualStreaming = Boolean(streamStatus.outputActive);
      this.actualRecording = Boolean(recordStatus.outputActive);
      const streaming = this.simulatedLive || this.actualStreaming;
      this.state = reduceOutputState(
        this.state,
        this.config,
        streaming,
        this.actualRecording,
        Date.now()
      );
      this.errorMessage = null;
      this.emitSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 OBS 推流/录制状态失败。';
      const now = Date.now();
      this.errorMessage = message;
      this.actualStreaming = false;
      this.actualRecording = false;
      const next: MonitorRuntimeState = {
        ...this.state,
        streaming: false,
        recording: false,
        lastLevelDb: null,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null,
        ignoredUntilAudioReturns: false
      };
      this.state = {
        ...next,
        status: deriveStatus(next, this.config, now)
      };
      this.emitSnapshot();
    }
  }

  private handleVolumeMeters(event: OBSInputVolumeMetersEvent): void {
    if (this.testAlertRestore) {
      return;
    }

    const target = this.config.targetInputName;
    if (!target) {
      return;
    }

    const input = event.inputs.find((item) => item.inputName === target);
    if (!input) {
      return;
    }

    const wasAlertVisible = this.state.alertVisible;
    const now = Date.now();
    this.lastTargetMeterAt = now;
    this.state = reduceAudioLevel(this.state, this.config, maxInputLevelDb(input.inputLevelsMul), now);
    const snapshot = this.getSnapshot();

    if (!wasAlertVisible && this.state.alertVisible) {
      this.emit('alert', snapshot);
    }

    this.emit('snapshot', snapshot);
  }

  private markDisconnected(message: string): void {
    this.simulatedLive = false;
    this.actualStreaming = false;
    this.actualRecording = false;
    this.inputs = [];
    this.state = this.unavailableState('disconnected');
    this.lastTargetMeterAt = null;
    this.errorMessage = message;
    this.stopOutputPolling();
    this.emitSnapshot();
  }

  private unavailableState(status: 'connecting' | 'disconnected'): MonitorRuntimeState {
    return {
      ...initialRuntimeState,
      status,
      snoozedUntil: this.state.snoozedUntil
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, 5000);
  }

  private startOutputPolling(): void {
    this.stopOutputPolling();
    this.outputTimer = setInterval(() => {
      void this.pollOutputState();
    }, 5000);
  }

  private stopOutputPolling(): void {
    if (this.outputTimer) {
      clearInterval(this.outputTimer);
      this.outputTimer = null;
    }
  }

  private startTicking(): void {
    if (this.tickTimer) {
      return;
    }

    this.tickTimer = setInterval(() => {
      const now = Date.now();
      if (this.state.snoozedUntil !== null && this.state.snoozedUntil <= now) {
        this.state = {
          ...this.state,
          snoozedUntil: null,
          preAlertDismissedSilentSince: null
        };
      }
      if (this.lastTargetMeterAt !== null && now - this.lastTargetMeterAt > 5000 && !this.state.alertVisible) {
        this.state = {
          ...this.state,
          lastLevelDb: null,
          silentSince: null,
          preAlertDismissedSilentSince: null
        };
      }
      this.state = {
        ...this.state,
        status: deriveStatus(this.state, this.config, now)
      };
      this.emitSnapshot(now);
    }, 1000);
  }

  private clearTimers(): void {
    this.stopOutputPolling();

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.clearReconnect();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitSnapshot(now = Date.now()): void {
    this.emit('snapshot', this.getSnapshot(now));
  }

  private getReadinessReason(now: number): ReadinessReason {
    if (this.config.paused) {
      return 'paused';
    }

    if (!this.state.connected) {
      return this.state.status === 'connecting' ? 'obs_connecting' : 'obs_disconnected';
    }

    if (this.state.snoozedUntil !== null && this.state.snoozedUntil > now) {
      return 'snoozed';
    }

    if (this.state.alertVisible) {
      return 'alerting';
    }

    if (this.errorMessage) {
      return 'error';
    }

    if (!this.state.streaming && !this.state.recording) {
      return 'not_streaming_or_recording';
    }

    if (!this.config.targetInputName) {
      return 'no_target_selected';
    }

    if (this.inputs.length > 0 && !this.inputs.some((input) => input.inputName === this.config.targetInputName)) {
      return 'target_missing';
    }

    if (this.lastTargetMeterAt === null || now - this.lastTargetMeterAt > 5000) {
      return 'no_target_meter';
    }

    return 'ready';
  }
}
