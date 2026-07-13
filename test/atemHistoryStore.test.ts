import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  userData: `${process.env.TMPDIR ?? process.env.TEMP ?? '.'}/obs-audio-assistant-atem-history-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userData
  }
}));

const { ATEMHistoryStore } = await import('../src/main/atemHistoryStore.js');

afterAll(() => {
  rmSync(electronMock.userData, { recursive: true, force: true });
});

describe('ATEMHistoryStore', () => {
  it('persists camera switch direction and duration', async () => {
    const store = new ATEMHistoryStore();
    await store.add({
      id: 'switch-1',
      switchedAt: 2_000,
      fromInputId: 1,
      fromInputLabel: 'Camera 1',
      toInputId: 2,
      toInputLabel: 'Camera 2',
      startedAt: 1_000,
      durationSeconds: 1
    });

    const reloaded = await new ATEMHistoryStore().load();
    expect(reloaded).toEqual([
      expect.objectContaining({
        fromInputLabel: 'Camera 1',
        toInputLabel: 'Camera 2',
        durationSeconds: 1
      })
    ]);
  });
});
