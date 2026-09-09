export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
export function nextTask(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      // Each continuation owns its ports. Close them before resuming, including when the
      // caller was aborted while waiting; no document or module retains an idle channel.
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
/** Observe cancellation promptly and dispose any successful late resource. */
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}
export function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}
