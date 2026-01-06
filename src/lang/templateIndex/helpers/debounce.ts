// Re-export from shared debounce helper for backward compatibility
import { DebouncedMap } from '../../../shared/helpers/debounce';

const debounceMap = new DebouncedMap();

export function scheduleDebounced(key: string, action: () => void, delayMs: number): void {
  debounceMap.schedule(key, action, delayMs);
}

export function cancelDebounced(key: string): void {
  debounceMap.cancel(key);
}
