export interface UsageCache<T> {
  value?: T;
  pending?: Promise<T>;
}

/** Adapters own HMR-stable state and decide when their cached response expires. */
export function createUsageCache<T extends { checkedAt: number }>(
  state: UsageCache<T>,
  load: () => Promise<T>,
  expiresAt: (value: T) => number = (value) => value.checkedAt + 60000,
): () => Promise<T> {
  return () => {
    if (state.pending) return state.pending;
    if (state.value && Date.now() < expiresAt(state.value)) return Promise.resolve(state.value);
    state.pending = Promise.resolve().then(load).then((value) => {
      state.value = value;
      return value;
    }).finally(() => { state.pending = undefined; });
    return state.pending;
  };
}
