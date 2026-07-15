export type LatestTask<T> = (generation: number) => Promise<T>;

/**
 * Serializes async work while allowing callers to invalidate stale generations.
 * Calls queued during an older generation are coalesced into the latest task.
 */
export class LatestTaskQueue<T> {
  private generation = 0;
  private active: { generation: number; promise: Promise<T> } | null = null;
  private queued: Promise<T> | null = null;
  private latestTask: LatestTask<T> | null = null;

  get currentGeneration(): number {
    return this.generation;
  }

  get isBusy(): boolean {
    return this.active !== null;
  }

  get isRunningCurrentGeneration(): boolean {
    return this.active?.generation === this.generation;
  }

  invalidate(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  run(task: LatestTask<T>): Promise<T> {
    this.latestTask = task;

    if (!this.active) {
      return this.start(task, this.generation);
    }

    if (this.active.generation === this.generation) {
      return this.active.promise;
    }

    if (this.queued) {
      return this.queued;
    }

    const activePromise = this.active.promise;
    let queuedPromise!: Promise<T>;
    const startLatest = (): Promise<T> => {
      if (this.queued === queuedPromise) {
        this.queued = null;
      }
      const latestTask = this.latestTask;
      if (!latestTask) {
        throw new Error('No task is available for the latest generation');
      }
      return this.start(latestTask, this.generation);
    };

    queuedPromise = activePromise.then(startLatest, startLatest);
    this.queued = queuedPromise;
    return queuedPromise;
  }

  private start(task: LatestTask<T>, generation: number): Promise<T> {
    let trackedPromise!: Promise<T>;
    trackedPromise = Promise.resolve()
      .then(() => task(generation))
      .finally(() => {
        if (this.active?.promise === trackedPromise) {
          this.active = null;
        }
      });
    this.active = { generation, promise: trackedPromise };
    return trackedPromise;
  }
}
