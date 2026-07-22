import { describe, expect, it, vi } from 'vitest';

const atemMock = vi.hoisted(() => {
  type Listener = (...args: any[]) => void;
  const state = {
    info: { productIdentifier: 'Mock ATEM' },
    inputs: {
      1: { longName: 'Camera 1', shortName: 'Cam 1' },
      2: { longName: 'Camera 2', shortName: 'Cam 2' }
    },
    video: { mixEffects: [{ programInput: 1, previewInput: 2 }] }
  };

  class MockAtem {
    status = 2;
    state = state;
    listeners = new Map<string, Set<Listener>>();
    connectCalls: Array<{ host: string; port?: number }> = [];

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: Listener): this {
      const wrapped: Listener = (...args) => {
        this.listeners.get(event)?.delete(wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
    }

    removeAllListeners(): this {
      this.listeners.clear();
      return this;
    }

    async connect(host: string, port?: number): Promise<void> {
      this.connectCalls.push({ host, port });
      if (host === '192.0.2.1') throw new Error('ECONNREFUSED');
      this.emit('connected');
      if (atemMock.emitStateOnConnect) this.emit('stateChanged', this.state);
    }

    async disconnect(): Promise<void> {}
    async destroy(): Promise<void> {}
    async changePreviewInput(): Promise<void> {}
    async changeProgramInput(): Promise<void> {}
    async autoTransition(): Promise<void> {}
  }

  return {
    Atem: MockAtem,
    AtemConnectionStatus: { CONNECTED: 2 },
    Enums: {
      InternalPortType: {
        External: 0,
        ColorBars: 2,
        ColorGenerator: 3,
        MediaPlayerFill: 4,
        MediaPlayerKey: 5
      }
    },
    state,
    emitStateOnConnect: true
  };
});

vi.mock('atem-connection', () => atemMock);

const { ATEMMonitor } = await import('../src/main/ATEMMonitor.js');

describe('ATEMMonitor connection lifecycle', () => {
  it('connects with the ATEM protocol port and reads the initial state', async () => {
    const monitor = new ATEMMonitor();
    const result = await monitor.testConnection(' 192.168.1.240 ');

    expect(result).toEqual({
      ok: true,
      message: '连接成功！检测到 Mock ATEM，可用信号源 2 路',
      inputCount: 2,
      modelName: 'Mock ATEM'
    });

    await monitor.setConfig(true, '192.168.1.240');
    expect(monitor.getSnapshot()).toMatchObject({
      connected: true,
      connectionState: 'connected',
      programInput: 1,
      previewInput: 2,
      inputCount: 2,
      programInputStartedAt: null,
      programInputElapsedSeconds: 0
    });
    await monitor.stop();
  });

  it('starts and resets the current camera timer with the live session', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');

    const firstLiveStartedAt = Date.now() - 4_000;
    monitor.setLiveActive(true, firstLiveStartedAt);
    expect(monitor.getSnapshot()).toMatchObject({
      programInput: 1,
      programInputStartedAt: firstLiveStartedAt
    });
    expect(monitor.getSnapshot().programInputElapsedSeconds).toBeGreaterThanOrEqual(4);

    monitor.setLiveActive(false);
    expect(monitor.getSnapshot()).toMatchObject({
      programInputStartedAt: null,
      programInputElapsedSeconds: 0,
      programInputOverLimit: false
    });

    const secondLiveStartedAt = Date.now();
    monitor.setLiveActive(true, secondLiveStartedAt);
    expect(monitor.getSnapshot()).toMatchObject({
      programInputStartedAt: secondLiveStartedAt,
      programInputElapsedSeconds: 0
    });
    await monitor.stop();
  });

  it('raises the default eight-minute camera alert and starts a fresh interval after confirmation', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    monitor.setLiveActive(true);
    const internals = monitor as unknown as { programInputStartedAt: number | null };
    internals.programInputStartedAt = Date.now() - 481_000;

    expect(monitor.getSnapshot()).toMatchObject({
      programInputOverLimit: true,
      cameraAlertVisible: true
    });

    const acknowledgedAt = Date.now();
    monitor.handleCameraAlertAction('acknowledge', acknowledgedAt);
    expect(monitor.getSnapshot()).toMatchObject({
      programInputStartedAt: acknowledgedAt,
      programInputElapsedSeconds: 0,
      programInputOverLimit: false,
      cameraAlertVisible: false
    });
    await monitor.stop();
  });

  it('snoozes a camera alert for five minutes and starts a fresh interval afterwards', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    monitor.setLiveActive(true);
    const internals = monitor as unknown as {
      programInputStartedAt: number | null;
      cameraSnoozedUntil: number | null;
    };
    internals.programInputStartedAt = Date.now() - 481_000;

    const ignoredAt = Date.now();
    monitor.handleCameraAlertAction('ignore_once', ignoredAt);
    expect(monitor.getSnapshot()).toMatchObject({
      programInputStartedAt: ignoredAt + 300_000,
      programInputElapsedSeconds: 0,
      programInputOverLimit: false,
      cameraAlertVisible: false
    });

    internals.cameraSnoozedUntil = Date.now() - 1;
    internals.programInputStartedAt = Date.now() - 479_000;
    expect(monitor.getSnapshot().cameraAlertVisible).toBe(false);
    internals.programInputStartedAt = Date.now() - 481_000;
    expect(monitor.getSnapshot().cameraAlertVisible).toBe(true);
    await monitor.stop();
  });

  it('never raises a camera alert while ATEM is disconnected or the camera alarm is disabled', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240', 480, false);
    monitor.setLiveActive(true);
    const internals = monitor as unknown as {
      programInputStartedAt: number | null;
      atem: { emit: (event: string) => void } | null;
    };
    internals.programInputStartedAt = Date.now() - 481_000;
    expect(monitor.getSnapshot().cameraAlertVisible).toBe(false);

    await monitor.setConfig(true, '192.168.1.240', 480, true);
    monitor.setLiveActive(false);
    monitor.setLiveActive(true);
    internals.programInputStartedAt = Date.now() - 481_000;
    internals.atem?.emit('disconnected');
    expect(monitor.getSnapshot()).toMatchObject({
      connected: false,
      programInputStartedAt: null,
      programInputOverLimit: false,
      cameraAlertVisible: false
    });
    await monitor.stop();
  });

  it('does not record camera switches outside live or simulated live mode', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    const updateState = (monitor as unknown as { updateStateFromATEM: (next: unknown) => void }).updateStateFromATEM.bind(monitor);
    const records: Array<{ fromInputId: number; toInputId: number }> = [];
    monitor.on('switchRecorded', (entry) => records.push(entry));

    updateState({ ...atemMock.state, video: { mixEffects: [{ programInput: 2, previewInput: 1 }] } });

    expect(records).toHaveLength(0);
    expect(monitor.getSnapshot().programInputStartedAt).toBeNull();
    await monitor.stop();
  });

  it('returns a clear failure when the ATEM refuses the connection', async () => {
    const monitor = new ATEMMonitor();
    const result = await monitor.testConnection('192.0.2.1');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
    await monitor.stop();
  });

  it('does not keep a stale connected state after an invalid address is saved', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, 'not-an-ip');

    expect(monitor.getSnapshot()).toMatchObject({
      connected: false,
      connectionState: 'error',
      errorMessage: '请输入有效的 ATEM IP 地址'
    });
    await monitor.stop();
  });

  it('rejects switching commands when ATEM is disconnected', async () => {
    const monitor = new ATEMMonitor();

    await expect(monitor.changePreviewInput(1)).rejects.toThrow('ATEM 未连接');
    await expect(monitor.autoTransition()).rejects.toThrow('ATEM 未连接');
  });

  it('does not start a camera timer when no PGM input is active', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    monitor.setLiveActive(true);
    const updateState = (monitor as unknown as { updateStateFromATEM: (next: unknown) => void }).updateStateFromATEM.bind(monitor);

    updateState({ ...atemMock.state, video: { mixEffects: [{ programInput: 0, previewInput: 2 }] } });

    expect(monitor.getSnapshot()).toMatchObject({
      programInput: 0,
      programInputStartedAt: null,
      programInputElapsedSeconds: 0,
      programInputOverLimit: false
    });
    await monitor.stop();
  });

  it('records the previous camera duration and the destination on a PGM switch', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    monitor.setLiveActive(true);
    const updateState = (monitor as unknown as { updateStateFromATEM: (next: unknown) => void }).updateStateFromATEM.bind(monitor);
    const internals = monitor as unknown as { programInputStartedAt: number | null };
    internals.programInputStartedAt = Date.now() - 125_000;
    const records: Array<{ fromInputId: number; toInputId: number; durationSeconds: number }> = [];
    monitor.on('switchRecorded', (entry) => records.push(entry));

    updateState({ ...atemMock.state, video: { mixEffects: [{ programInput: 2, previewInput: 1 }] } });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      fromInputId: 1,
      toInputId: 2,
      durationSeconds: 125
    });
    expect(monitor.getSnapshot().programInputStartedAt).not.toBeNull();
    await monitor.stop();
  });

  it('only exposes cameras 1-8, color sources, bars and media-player fills', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    const updateState = (monitor as unknown as { updateStateFromATEM: (next: unknown) => void }).updateStateFromATEM.bind(monitor);

    updateState({
      ...atemMock.state,
      inputs: {
        1: { longName: 'Camera 1', shortName: 'Cam 1', internalPortType: 0 },
        8: { longName: 'Camera 8', shortName: 'Cam 8', internalPortType: 0 },
        9: { longName: 'Camera 9', shortName: 'Cam 9', internalPortType: 0 },
        1000: { longName: 'Bars', shortName: 'Bars', internalPortType: 2 },
        2001: { longName: 'Color 1', shortName: 'Col1', internalPortType: 3 },
        3010: { longName: 'Media Player 1', shortName: 'MP1', internalPortType: 4 },
        3011: { longName: 'Media Player Key', shortName: 'MPK', internalPortType: 5 },
        10010: { longName: 'Aux 1', shortName: 'Aux1', internalPortType: 129 }
      }
    });

    expect(monitor.getSnapshot()).toMatchObject({
      inputIds: [1, 8, 1000, 2001, 3010],
      inputCount: 5
    });
    await monitor.stop();
  });

  it('reports the active configured switcher as discovered without opening a second session', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
    const internals = monitor as unknown as {
      buildCandidateHosts: () => Array<{ host: string; interfaceName: string; network: string }>;
      probeATEMHosts: () => Promise<Array<{ host: string }>>;
    };
    vi.spyOn(internals, 'buildCandidateHosts').mockReturnValue([
      { host: '192.168.1.240', interfaceName: '当前设置', network: '手动地址' }
    ]);
    vi.spyOn(internals, 'probeATEMHosts').mockResolvedValue([]);

    const result = await monitor.scanNetwork('192.168.1.240');
    expect(result.ok).toBe(true);
    expect(result.devices[0]).toMatchObject({ host: '192.168.1.240', inputCount: 2 });
    await monitor.stop();
  });

  it('reuses the active connection when testing the configured address', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');

    const result = await monitor.testConnection('192.168.1.240');
    expect(result).toEqual({
      ok: true,
      message: '已连接 Mock ATEM，可用信号源 2 路',
      inputCount: 2,
      modelName: 'Mock ATEM'
    });
    await monitor.stop();
  });

  it('hydrates inputs after connected even when no stateChanged event follows', async () => {
    atemMock.emitStateOnConnect = false;
    const monitor = new ATEMMonitor();
    try {
      await monitor.setConfig(true, '192.168.1.240');
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(monitor.getSnapshot()).toMatchObject({
        connected: true,
        programInput: 1,
        previewInput: 2,
        inputIds: [1, 2]
      });
    } finally {
      atemMock.emitStateOnConnect = true;
      await monitor.stop();
    }
  });
});
