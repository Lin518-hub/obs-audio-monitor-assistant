import { EventEmitter } from 'node:events';
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { maxInputLevelDb, smoothMeterLevel } from '../shared/audio.js';
import { isProbablyAudibleInputKind } from '../shared/inputKinds.js';
import { reconnectBackoffDelay } from '../shared/reconnect.js';
import {
  deriveStatus,
  initialRuntimeState,
  isPreAlertVisible,
  preAlertRemainingSeconds,
  reducePreAlertDismiss,
  reduceAlertAction,
  reduceOutputState,
  secondsUntilAlert,
  silentForSeconds,
  type MonitorRuntimeState
} from '../shared/silenceState.js';
import type {
  AlertAction,
  AudioMeterFrame,
  AlertHistoryEntry,
  AppConfig,
  AppSnapshot,
  DisplayInfo,
  InputOption,
  InputMonitorSnapshot,
  OBSStatsSnapshot,
  ReadinessReason,
  SilenceEventEntry,
  TestConnectionResult
} from '../shared/types.js';

const METER_STALE_MS = 5000;
const VOLUME_HISTORY_RETENTION_MS = 10 * 60 * 1000;
const VOLUME_HISTORY_SAMPLE_MS = 500;
// The dedicated meter channel keeps the level bar at 25 fps. Full snapshots
// only carry state/countdown changes, so emitting them once per second avoids
// rerendering every desktop surface four times per second.
const METER_SNAPSHOT_THROTTLE_MS = 1000;
const METER_FRAME_INTERVAL_MS = 40;
const VOLUME_HISTORY_BROADCAST_MS = 1000;
const MAX_SILENCE_EVENTS = 100;
const AUDIBLE_CONFIRM_MS = 120;
const THRESHOLD_HYSTERESIS_DB = 1.5;

interface MonitorEvents {
  snapshot: [AppSnapshot];
  alert: [AppSnapshot];
  meter: [AudioMeterFrame];
}

type OBSInputVolumeMetersEvent = {
  inputs: Array<{
    inputName: string;
    inputLevelsMul: number[][];
  }>;
};

interface PerInputMonitorState {
  inputName: string;
  inputKind: string;
  lastLevelDb: number | null;
  rawLevelDb: number | null;
  lastMeterAt: number | null;
  silentSince: number | null;
  activeEventId: string | null;
  alertTriggered: boolean;
  lastAboveThresholdAt: number | null;
  aboveThresholdSince: number | null;
}

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
  private meterSnapshotTimer: NodeJS.Timeout | null = null;
  private pendingMeterSnapshotAt: number | null = null;
  private lastMeterSnapshotAt = 0;
  private meterFrameTimer: NodeJS.Timeout | null = null;
  private pendingMeterFrame: AudioMeterFrame | null = null;
  private lastMeterFrameAt = 0;
  private testAlertRestore: { state: MonitorRuntimeState; errorMessage: string | null; inputs: InputOption[]; lastTargetMeterAt: number | null } | null = null;
  private history: AlertHistoryEntry[] = [];
  private silenceEvents: SilenceEventEntry[] = [];
  private inputStates = new Map<string, PerInputMonitorState>();
  private cachedTargetInputNames: string[] | null = null;
  private cachedTargetInputSet: Set<string> | null = null;
  private cachedInputList: InputOption[] | null = null;
  private cachedInputKinds = new Map<string, string>();
  private activeInputName = '';
  private volumeHistory: AppSnapshot['volumeHistory'] = [];
  private volumeHistoryLastAt = new Map<string, number>();
  private lastVolumeHistoryPrunedAt = 0;
  private lastVolumeHistoryBroadcastAt = 0;
  private obsStats: OBSStatsSnapshot = emptyOBSStats();
  private lastTargetMeterAt: number | null = null;
  private lastAudioMeterReceivedAt: number | null = null;
  private reconnectAttempt = 0;
  private simulatedLive = false;
  private actualStreaming = false;
  private actualRecording = false;

  constructor(config: AppConfig, displays: DisplayInfo[]) {
    super();
    this.config = config;
    this.displays = displays;
  }

  getSnapshot(now = Date.now(), includeVolumeHistory = true): AppSnapshot {
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
      activeInputName: this.activeInputName || this.getTargetInputNames()[0] || '',
      lastLevelDb: this.state.lastLevelDb,
      lastAudioMeterReceivedAt: this.lastAudioMeterReceivedAt,
      audioSpeaking: this.isAudioSpeaking(now),
      silentForSeconds: silentForSeconds(this.state, now),
      secondsUntilAlert: secondsUntilAlert(this.state, this.config, now),
      alertVisible: this.state.alertVisible,
      readinessReason,
      preAlertVisible,
      preAlertRemainingSeconds: preAlertVisible ? preAlertRemainingSeconds(this.state, this.config, now) : null,
      preAlertDismissed: this.state.silentSince !== null && this.state.preAlertDismissedSilentSince === this.state.silentSince,
      snoozedUntil: this.state.snoozedUntil,
      history: this.history,
      silenceEvents: this.silenceEvents,
      inputMonitors: this.getInputMonitorSnapshots(now),
      // 高频状态快照不重复克隆整段历史数据；图表数据每秒同步一次。
      volumeHistory: includeVolumeHistory ? this.volumeHistory : [],
      obsStats: this.obsStats,
      errorMessage: this.errorMessage,
      // ATEM 字段由 main.ts 的 injectATEMState() 注入，此处提供默认值
      atemConnected: false,
      atemConnectionState: 'disconnected',
      atemModelName: null,
      atemProgramInput: 0,
      atemPreviewInput: 0,
      atemInputIds: [],
      atemInputLabels: {},
      atemInputHardwareLabels: {},
      atemInputCount: 0,
      atemProgramInputStartedAt: null,
      atemProgramInputElapsedSeconds: 0,
      atemProgramInputOverLimit: false,
      atemSwitchHistory: [],
      atemReconnectAttempt: 0,
      atemNextReconnectAt: null,
      atemCurrentSession: null,
      atemRecentSessions: [],
      remoteAccessConnectionState: 'disabled',
      remoteAccessConnected: false,
      remoteAccessActiveServerUrl: null,
      remoteAccessPairUrl: null,
      remoteAccessErrorMessage: null,
      remoteAccessLastConnectedAt: null,
      remoteAccessRouteType: null,
      remoteAccessLatencyMs: null,
      remoteAccessOnlineMobileClients: 0,
      remoteAccessLastSyncAt: null
    };
  }

  async start(): Promise<void> {
    this.startTicking();
    await this.connect(true);
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
    const targetsChanged = targetKey(previous) !== targetKey(this.config);
    if (targetsChanged) {
      this.cachedTargetInputNames = null;
      this.cachedTargetInputSet = null;
    }

    if (this.config.paused) {
      this.state = {
        ...this.state,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null
      };
    }

    if (targetsChanged) {
      this.lastTargetMeterAt = null;
      this.lastAudioMeterReceivedAt = null;
      this.activeInputName = this.getTargetInputNames()[0] || '';
      this.clearSilentInputStates();
      this.state = {
        ...this.state,
        lastLevelDb: null,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null
      };
    }

    if (previous.silenceThresholdDb !== this.config.silenceThresholdDb) {
      for (const state of this.inputStates.values()) {
        state.aboveThresholdSince = null;
      }
    }

    const connectionChanged =
      previous.obsHost !== this.config.obsHost ||
      previous.obsPort !== this.config.obsPort ||
      previous.obsPassword !== this.config.obsPassword;

    this.emitSnapshot();

    if (connectionChanged) {
      await this.connect(true);
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
    this.activeInputName = this.getTargetInputNames()[0] || '';
    this.clearSilentInputStates();
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
    await this.connect(true);
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

  async openProgramProjector(): Promise<void> {
    if (!this.obs || !this.state.connected) {
      throw new Error('OBS WebSocket 尚未连接');
    }
    await this.obs.call('OpenVideoMixProjector', {
      videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM',
      monitorIndex: -1
    });
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

    this.clearSilentInputStates();
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
    this.activeInputName = targetInputName;
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

  private async connect(manual = false): Promise<void> {
    if (manual) this.reconnectAttempt = 0;
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
      await this.pollOBSStats();
      this.reconnectAttempt = 0;
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

    for (const input of this.inputs) {
      this.ensureInputState(input.inputName, input.inputKind);
    }
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

  private async pollOBSStats(): Promise<void> {
    if (!this.obs || !this.state.connected) {
      this.obsStats = emptyOBSStats();
      return;
    }

    try {
      const stats = await this.obs.call('GetStats');
      this.obsStats = {
        cpuUsage: numberOrNull(stats.cpuUsage),
        memoryUsageMb: bytesToMb(numberOrNull(stats.memoryUsage)),
        availableDiskSpaceMb: bytesToMb(numberOrNull(stats.availableDiskSpace)),
        activeFps: numberOrNull(stats.activeFps),
        averageFrameRenderTimeMs: numberOrNull(stats.averageFrameRenderTime),
        renderSkippedFrames: numberOrNull(stats.renderSkippedFrames),
        renderTotalFrames: numberOrNull(stats.renderTotalFrames),
        outputSkippedFrames: numberOrNull(stats.outputSkippedFrames),
        outputTotalFrames: numberOrNull(stats.outputTotalFrames),
        streamBitrateKbps: numberOrNull((stats as { outputSkippedFrames?: unknown; outputTotalFrames?: unknown; } & Record<string, unknown>).streamBitrate)
      };
    } catch {
      this.obsStats = emptyOBSStats();
    }
  }

  private handleVolumeMeters(event: OBSInputVolumeMetersEvent): void {
    if (this.testAlertRestore) {
      return;
    }

    const targets = this.getTargetInputNames();
    if (targets.length === 0) {
      return;
    }

    const targetSet = this.getTargetInputSet();
    const now = Date.now();
    let sawTarget = false;

    for (const item of event.inputs) {
      const name = item.inputName;
      if (!targetSet.has(name)) {
        continue;
      }

      sawTarget = true;
      const state = this.ensureInputState(name, this.getInputKind(name));
      const rawLevelDb = maxInputLevelDb(item.inputLevelsMul);
      this.updateInputLevel(state, rawLevelDb, now);
      const lastHistoryAt = this.volumeHistoryLastAt.get(name) ?? 0;
      if (now - lastHistoryAt >= VOLUME_HISTORY_SAMPLE_MS) {
        this.volumeHistoryLastAt.set(name, now);
        this.volumeHistory.push({ timestamp: now, inputName: name, levelDb: state.lastLevelDb });
      }
    }

    if (!sawTarget) {
      return;
    }

    this.pruneVolumeHistory(now);
    const wasAlertVisible = this.state.alertVisible;
    this.recomputeAggregateState(now);
    if (!wasAlertVisible && this.state.alertVisible) {
      this.emit('alert', this.getSnapshot(now));
    }

    this.emitMeterSnapshot(now);
    this.queueMeterFrame(now);
  }

  private markDisconnected(message: string): void {
    this.simulatedLive = false;
    this.actualStreaming = false;
    this.actualRecording = false;
    this.inputs = [];
    this.state = this.unavailableState('disconnected');
    this.lastTargetMeterAt = null;
    this.activeInputName = '';
    this.obsStats = emptyOBSStats();
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
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = reconnectBackoffDelay(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(false);
    }, delay);
  }

  private startOutputPolling(): void {
    this.stopOutputPolling();
    this.outputTimer = setInterval(() => {
      void this.pollOutputState();
      void this.pollOBSStats();
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
      this.recomputeAggregateState(now);
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

    if (this.meterSnapshotTimer) {
      clearTimeout(this.meterSnapshotTimer);
      this.meterSnapshotTimer = null;
    }
    this.pendingMeterSnapshotAt = null;

    if (this.meterFrameTimer) {
      clearTimeout(this.meterFrameTimer);
      this.meterFrameTimer = null;
    }
    this.pendingMeterFrame = null;

    this.clearReconnect();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitSnapshot(now = Date.now(), includeVolumeHistory = true): void {
    this.emit('snapshot', this.getSnapshot(now, includeVolumeHistory));
  }

  private emitMeterSnapshot(now: number): void {
    this.pendingMeterSnapshotAt = now;
    if (this.meterSnapshotTimer) return;

    const waitMs = Math.max(0, METER_SNAPSHOT_THROTTLE_MS - (now - this.lastMeterSnapshotAt));
    this.meterSnapshotTimer = setTimeout(() => {
      this.meterSnapshotTimer = null;
      const timestamp = this.pendingMeterSnapshotAt ?? Date.now();
      this.pendingMeterSnapshotAt = null;
      if (!this.state.connected) return;
      this.lastMeterSnapshotAt = Date.now();
      const includeHistory = timestamp - this.lastVolumeHistoryBroadcastAt >= VOLUME_HISTORY_BROADCAST_MS;
      if (includeHistory) this.lastVolumeHistoryBroadcastAt = timestamp;
      this.emitSnapshot(timestamp, includeHistory);
    }, waitMs);
  }

  private getReadinessReason(now: number): ReadinessReason {
    const targets = this.getTargetInputNames();
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

    if (targets.length === 0) {
      return 'no_target_selected';
    }

    if (this.inputs.length > 0 && targets.some((target) => !this.inputs.some((input) => input.inputName === target))) {
      return 'target_missing';
    }

    if (this.lastTargetMeterAt === null || now - this.lastTargetMeterAt > METER_STALE_MS) {
      return 'no_target_meter';
    }

    return 'ready';
  }

  private getTargetInputNames(): string[] {
    if (this.cachedTargetInputNames) {
      return this.cachedTargetInputNames;
    }
    const fromList = Array.isArray(this.config.targetInputNames) ? this.config.targetInputNames : [];
    const names = fromList.length > 0 ? fromList : (this.config.targetInputName ? [this.config.targetInputName] : []);
    this.cachedTargetInputNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    return this.cachedTargetInputNames;
  }

  private getTargetInputSet(): Set<string> {
    if (!this.cachedTargetInputSet) {
      this.cachedTargetInputSet = new Set(this.getTargetInputNames());
    }
    return this.cachedTargetInputSet;
  }

  private getInputKind(inputName: string): string {
    if (this.cachedInputList !== this.inputs) {
      this.cachedInputList = this.inputs;
      this.cachedInputKinds = new Map(this.inputs.map((input) => [input.inputName, input.inputKind]));
    }
    return this.cachedInputKinds.get(inputName) ?? '';
  }

  private ensureInputState(inputName: string, inputKind: string): PerInputMonitorState {
    const existing = this.inputStates.get(inputName);
    if (existing) {
      existing.inputKind = inputKind || existing.inputKind;
      return existing;
    }

    const state: PerInputMonitorState = {
      inputName,
      inputKind,
      lastLevelDb: null,
      rawLevelDb: null,
      lastMeterAt: null,
      silentSince: null,
      activeEventId: null,
      alertTriggered: false,
      lastAboveThresholdAt: null,
      aboveThresholdSince: null
    };
    this.inputStates.set(inputName, state);
    return state;
  }

  private updateInputLevel(state: PerInputMonitorState, levelDb: number, now: number): void {
    const previousMeterAt = state.lastMeterAt;
    state.rawLevelDb = levelDb;
    state.lastLevelDb = smoothMeterLevel(state.lastLevelDb, levelDb, previousMeterAt === null ? 50 : now - previousMeterAt);
    state.lastMeterAt = now;
    this.lastTargetMeterAt = Math.max(this.lastTargetMeterAt ?? 0, now);
    this.lastAudioMeterReceivedAt = Math.max(this.lastAudioMeterReceivedAt ?? 0, now);

    const wasConfirmedSpeaking = state.silentSince === null && state.lastAboveThresholdAt !== null;
    const audibleThreshold = this.config.silenceThresholdDb + (wasConfirmedSpeaking ? -THRESHOLD_HYSTERESIS_DB : THRESHOLD_HYSTERESIS_DB);
    if (levelDb > audibleThreshold) {
      state.aboveThresholdSince ??= now;
      if (!wasConfirmedSpeaking && now - state.aboveThresholdSince < AUDIBLE_CONFIRM_MS) {
        return;
      }
      state.lastAboveThresholdAt = now;
      if (state.silentSince !== null) {
        this.finishSilenceEvent(state, now);
      }
      state.silentSince = null;
      state.activeEventId = null;
      state.alertTriggered = false;
      return;
    }

    state.aboveThresholdSince = null;
    if (state.silentSince === null) {
      state.silentSince = now;
      state.alertTriggered = false;
      state.activeEventId = this.startSilenceEvent(state, now);
    }
  }

  private recomputeAggregateState(now: number): void {
    const targets = this.getTargetInputNames();
    const canMonitor =
      this.state.connected &&
      !this.config.paused &&
      (this.state.streaming || this.state.recording) &&
      !(this.state.snoozedUntil !== null && this.state.snoozedUntil > now);

    if (!canMonitor || targets.length === 0) {
      this.state = {
        ...this.state,
        lastLevelDb: null,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null,
        ignoredUntilAudioReturns: false,
        status: deriveStatus(this.state, this.config, now)
      };
      return;
    }

    const states = targets
      .map((target) => this.inputStates.get(target))
      .filter((state): state is PerInputMonitorState => Boolean(state && state.lastMeterAt !== null && now - state.lastMeterAt <= METER_STALE_MS));

    if (states.length === 0) {
      this.state = {
        ...this.state,
        lastLevelDb: null,
        silentSince: null,
        preAlertDismissedSilentSince: null,
        status: deriveStatus(this.state, this.config, now)
      };
      return;
    }

    const silentStates = states
      .filter((state) => state.silentSince !== null)
      .sort((a, b) => (a.silentSince ?? now) - (b.silentSince ?? now));

    if (silentStates.length === 0) {
      const loudest = [...states].sort((a, b) => (b.lastLevelDb ?? -100) - (a.lastLevelDb ?? -100))[0];
      this.activeInputName = loudest?.inputName ?? targets[0] ?? '';
      this.state = {
        ...this.state,
        lastLevelDb: loudest?.lastLevelDb ?? null,
        silentSince: null,
        alertVisible: false,
        preAlertDismissedSilentSince: null,
        ignoredUntilAudioReturns: false,
        status: deriveStatus(this.state, this.config, now)
      };
      return;
    }

    const active = silentStates[0];
    this.activeInputName = active.inputName;
    const silentSince = active.silentSince ?? now;
    const shouldAlert = !this.state.alertVisible && now - silentSince >= this.config.silenceDurationSeconds * 1000;
    if (shouldAlert) {
      active.alertTriggered = true;
      this.markSilenceEventAlerted(active);
    }

    this.state = {
      ...this.state,
      lastLevelDb: active.lastLevelDb,
      silentSince,
      alertVisible: this.state.alertVisible || shouldAlert,
      status: deriveStatus(this.state, this.config, now)
    };
  }

  private getInputMonitorSnapshots(now: number): InputMonitorSnapshot[] {
    const selected = new Set(this.getTargetInputNames());
    const knownNames = new Set([...this.inputs.map((input) => input.inputName), ...selected]);
    return Array.from(knownNames).map((inputName) => {
      const input = this.inputs.find((item) => item.inputName === inputName);
      const state = this.inputStates.get(inputName);
      const lastMeterAt = state?.lastMeterAt ?? null;
      const isFresh = lastMeterAt !== null && now - lastMeterAt <= METER_STALE_MS;
      const silentSeconds = state?.silentSince ? Math.max(0, Math.floor((now - state.silentSince) / 1000)) : 0;
      const selectedInput = selected.has(inputName);
      return {
        inputName,
        inputKind: input?.inputKind ?? state?.inputKind ?? '',
        selected: selectedInput,
        lastLevelDb: isFresh ? state?.lastLevelDb ?? null : null,
        lastMeterAt,
        silentForSeconds: silentSeconds,
        secondsUntilAlert: selectedInput && state?.silentSince
          ? Math.max(0, this.config.silenceDurationSeconds - silentSeconds)
          : null,
        status: !selectedInput ? 'not_selected' : !isFresh ? 'missing_meter' : state?.silentSince ? 'silent' : 'normal'
      };
    });
  }

  private isAudioSpeaking(now: number): boolean {
    const state = this.inputStates.get(this.activeInputName);
    if (!state || state.lastAboveThresholdAt === null) {
      return false;
    }

    // Keep the last confirmed speaking state through short breaths, but never
    // establish it unless the input actually crossed the configured threshold.
    return now - state.lastAboveThresholdAt < 3000;
  }

  private clearSilentInputStates(): void {
    const now = Date.now();
    for (const state of this.inputStates.values()) {
      if (state.silentSince !== null) {
        this.finishSilenceEvent(state, now);
      }
      state.silentSince = null;
      state.activeEventId = null;
      state.alertTriggered = false;
      state.lastAboveThresholdAt = null;
      state.aboveThresholdSince = null;
    }
  }

  private queueMeterFrame(now: number): void {
    this.pendingMeterFrame = {
      timestamp: now,
      activeInputName: this.activeInputName || this.getTargetInputNames()[0] || '',
      levelDb: this.state.lastLevelDb
    };
    if (this.meterFrameTimer) return;

    const waitMs = Math.max(0, METER_FRAME_INTERVAL_MS - (now - this.lastMeterFrameAt));
    this.meterFrameTimer = setTimeout(() => {
      this.meterFrameTimer = null;
      const frame = this.pendingMeterFrame;
      this.pendingMeterFrame = null;
      if (!frame) return;
      this.lastMeterFrameAt = Date.now();
      this.emit('meter', frame);
    }, waitMs);
  }

  private startSilenceEvent(state: PerInputMonitorState, now: number): string {
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    this.silenceEvents = [
      {
        id,
        inputName: state.inputName,
        startedAt: now,
        recoveredAt: null,
        durationSeconds: 0,
        alertTriggered: false
      },
      ...this.silenceEvents
    ].slice(0, MAX_SILENCE_EVENTS);
    return id;
  }

  private finishSilenceEvent(state: PerInputMonitorState, now: number): void {
    if (!state.activeEventId || state.silentSince === null) {
      return;
    }

    this.silenceEvents = this.silenceEvents.map((entry) => entry.id === state.activeEventId
      ? {
          ...entry,
          recoveredAt: now,
          durationSeconds: Math.max(0, Math.floor((now - state.silentSince!) / 1000)),
          alertTriggered: entry.alertTriggered || state.alertTriggered
        }
      : entry
    );
  }

  private markSilenceEventAlerted(state: PerInputMonitorState): void {
    if (!state.activeEventId) {
      return;
    }

    this.silenceEvents = this.silenceEvents.map((entry) => entry.id === state.activeEventId
      ? { ...entry, alertTriggered: true }
      : entry
    );
  }

  private pruneVolumeHistory(now: number): void {
    if (now - this.lastVolumeHistoryPrunedAt < 1000) {
      return;
    }

    this.lastVolumeHistoryPrunedAt = now;
    const minTime = now - VOLUME_HISTORY_RETENTION_MS;
    this.volumeHistory = this.volumeHistory.filter((point) => point.timestamp >= minTime);
  }
}

function targetKey(config: AppConfig): string {
  const names = (config.targetInputNames?.length ? config.targetInputNames : config.targetInputName ? [config.targetInputName] : [])
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  return names.join('\n');
}

function emptyOBSStats(): OBSStatsSnapshot {
  return {
    cpuUsage: null,
    memoryUsageMb: null,
    availableDiskSpaceMb: null,
    activeFps: null,
    averageFrameRenderTimeMs: null,
    renderSkippedFrames: null,
    renderTotalFrames: null,
    outputSkippedFrames: null,
    outputTotalFrames: null,
    streamBitrateKbps: null
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bytesToMb(value: number | null): number | null {
  return value === null ? null : value / 1024 / 1024;
}
