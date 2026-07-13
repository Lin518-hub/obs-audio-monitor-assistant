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
      inputCount: 2
    });
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

  it('does not start a camera timer when no PGM input is active', async () => {
    const monitor = new ATEMMonitor();
    await monitor.setConfig(true, '192.168.1.240');
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
