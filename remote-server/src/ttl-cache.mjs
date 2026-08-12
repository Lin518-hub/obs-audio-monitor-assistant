export function createRevisionTtlCache(factory, { ttlMs = 1000, clock = () => Date.now() } = {}) {
  let cached = null;

  return {
    get(revision = 0) {
      const current = clock();
      if (cached && cached.revision === revision && current - cached.createdAt < ttlMs) {
        return cached.value;
      }
      const value = factory();
      cached = { revision, createdAt: current, value };
      return value;
    },
    clear() {
      cached = null;
    }
  };
}
