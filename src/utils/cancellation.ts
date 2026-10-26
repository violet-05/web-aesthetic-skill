import { setTimeout as delay } from "node:timers/promises";
export class ReviewTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`审查超过总时限 ${timeoutMs}ms，已中止剩余操作`);
    this.name = "ReviewTimeoutError";
  }
}
export class ReviewCancelledError extends Error {
  constructor() {
    super("用户取消了审查");
    this.name = "ReviewCancelledError";
  }
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new ReviewCancelledError();
}
/** Race only individual operations, never the mutable review pipeline. Late resources are disposed. */
export function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onLateResolve?: (value: T) => void | Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const cancel = () => {
      aborted = true;
      reject(signal.reason ?? new ReviewCancelledError());
    };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (aborted) {
          void Promise.resolve()
            .then(() => onLateResolve?.(value))
            .catch(() => {});
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancel);
        if (!aborted) reject(error);
      },
    );
  });
}
export async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
}
export function createReviewDeadline(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const started = Date.now();
  const cancel = () => controller.abort(new ReviewCancelledError());
  if (external?.aborted) cancel();
  else external?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new ReviewTimeoutError(timeoutMs)), timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    elapsedMs: () => Date.now() - started,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", cancel);
    },
  };
}
