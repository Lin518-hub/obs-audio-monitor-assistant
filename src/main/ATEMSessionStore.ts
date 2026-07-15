import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ATEMLiveSession, ATEMSessionSegment } from '../shared/types.js';

const MAX_SESSIONS = 10;

interface StoredATEMSessions {
  activeSession: ATEMLiveSession | null;
  sessions: ATEMLiveSession[];
}

export class ATEMSessionStore {
  private readonly path = join(app.getPath('userData'), 'atem-live-sessions.json');
  private state: StoredATEMSessions = { activeSession: null, sessions: [] };
  private persistQueue: Promise<void> = Promise.resolve();

  async load(): Promise<StoredATEMSessions> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredATEMSessions>;
      this.state = {
        activeSession: isValidSession(parsed.activeSession) ? parsed.activeSession : null,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isValidSession).slice(0, MAX_SESSIONS) : []
      };
    } catch {
      this.state = { activeSession: null, sessions: [] };
    }
    return this.snapshot();
  }

  snapshot(): StoredATEMSessions {
    return {
      activeSession: this.state.activeSession ? structuredClone(this.state.activeSession) : null,
      sessions: structuredClone(this.state.sessions)
    };
  }

  async start(startedAt: number): Promise<StoredATEMSessions> {
    if (!this.state.activeSession) {
      this.state.activeSession = {
        id: `live-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt,
        endedAt: null,
        segments: [],
        usage: [],
        totalDurationSeconds: 0
      };
      await this.queuePersist();
    }
    return this.snapshot();
  }

  async addSegment(segment: ATEMSessionSegment): Promise<StoredATEMSessions> {
    const active = this.state.activeSession;
    if (!active || segment.endedAt <= active.startedAt) return this.snapshot();
    const startedAt = Math.max(active.startedAt, segment.startedAt);
    const normalized = {
      ...segment,
      startedAt,
      durationSeconds: Math.max(0, Math.floor((segment.endedAt - startedAt) / 1000))
    };
    if (normalized.durationSeconds > 0 && !active.segments.some((entry) => entry.id === normalized.id)) {
      active.segments.push(normalized);
      await this.queuePersist();
    }
    return this.snapshot();
  }

  async finish(endedAt: number, finalSegment?: ATEMSessionSegment | null): Promise<StoredATEMSessions> {
    if (!this.state.activeSession) return this.snapshot();
    if (finalSegment) await this.addSegment(finalSegment);
    const finished = { ...this.state.activeSession, endedAt };
    this.state.activeSession = null;
    this.state.sessions = [finished, ...this.state.sessions.filter((session) => session.id !== finished.id)].slice(0, MAX_SESSIONS);
    await this.queuePersist();
    return this.snapshot();
  }

  private queuePersist(): Promise<void> {
    this.persistQueue = this.persistQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    });
    return this.persistQueue;
  }
}

function isValidSession(value: unknown): value is ATEMLiveSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ATEMLiveSession>;
  return typeof session.id === 'string'
    && Number.isFinite(session.startedAt)
    && (session.endedAt === null || Number.isFinite(session.endedAt))
    && Array.isArray(session.segments);
}
