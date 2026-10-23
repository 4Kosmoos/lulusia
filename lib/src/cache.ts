// Short-lived cache in front of FRM.

/**
 * Keeps the result of `load` for `ttlMs`. Simultaneous calls share the same request, so that FRM is not
 * called again for every key typed or every question asked. A failed load is not kept.
 */
export function cached<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let value: T | undefined;
  let loadedAt = 0;
  let pending: Promise<T> | undefined;
  return () => {
    if (value !== undefined && Date.now() - loadedAt < ttlMs) return Promise.resolve(value);
    pending ??= load()
      .then((result) => {
        value = result;
        loadedAt = Date.now();
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
