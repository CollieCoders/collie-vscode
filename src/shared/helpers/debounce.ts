/**
 * Manages debounced callbacks keyed by string identifiers.
 * Prevents duplicate pending operations for the same key.
 */
export class DebouncedMap {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Schedule a callback to run after a delay.
   * If a callback is already scheduled for the same key, it will be cancelled.
   * 
   * @param key - Unique identifier for this debounced operation
   * @param callback - Function to execute after the delay
   * @param delayMs - Delay in milliseconds (default: 300)
   */
  schedule(key: string, callback: () => void, delayMs = 300): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, delayMs);
    this.timers.set(key, timer);
  }

  /**
   * Cancel a pending callback for the given key.
   * 
   * @param key - Unique identifier for the debounced operation to cancel
   */
  cancel(key: string): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  /**
   * Cancel all pending callbacks.
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Check if a callback is pending for the given key.
   * 
   * @param key - Unique identifier to check
   * @returns true if a callback is pending for this key
   */
  has(key: string): boolean {
    return this.timers.has(key);
  }
}

/**
 * Simple debounce function for standalone use.
 * 
 * @param callback - Function to debounce
 * @param delayMs - Delay in milliseconds
 * @returns A debounced version of the callback
 */
export function debounce<T extends (...args: any[]) => void>(
  callback: T,
  delayMs = 300
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      callback(...args);
    }, delayMs);
  };
}
