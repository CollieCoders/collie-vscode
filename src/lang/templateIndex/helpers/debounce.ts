const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleDebounced(key: string, action: () => void, delayMs: number): void {
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    debounceTimers.delete(key);
    action();
  }, delayMs);
  debounceTimers.set(key, handle);
}

export function cancelDebounced(key: string): void {
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(key);
  }
}
