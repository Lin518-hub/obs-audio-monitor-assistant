/** Concurrent callers share one operation; success and failure both allow the next run. */
export class SingleFlight<T> {
  private pending: Promise<T> | null = null;
  run(action: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(action).finally(() => { this.pending = null; });
    return this.pending;
  }
}
