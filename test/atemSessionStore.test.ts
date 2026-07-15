import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  userData: `${process.env.TMPDIR ?? process.env.TEMP ?? '.'}/obs-audio-assistant-atem-sessions-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userData
  }
}));

const { ATEMSessionStore } = await import('../src/main/ATEMSessionStore.js');

afterAll(() => {
  rmSync(electronMock.userData, { recursive: true, force: true });
});

describe('ATEMSessionStore', () => {
  it('keeps only the ten most recent completed live sessions', async () => {
    const store = new ATEMSessionStore();

    for (let index = 0; index < 11; index += 1) {
      const startedAt = 10_000 + index * 10_000;
      await store.start(startedAt);
      await store.finish(startedAt + 5_000);
    }

    const reloaded = await new ATEMSessionStore().load();
    expect(reloaded.sessions).toHaveLength(10);
    expect(reloaded.sessions[0].startedAt).toBe(110_000);
    expect(reloaded.sessions.at(-1)?.startedAt).toBe(20_000);
  });
});
