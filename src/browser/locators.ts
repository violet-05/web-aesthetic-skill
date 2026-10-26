import type { Locator, Page } from "playwright";
import type { Target } from "../config.js";
import { abortable, pause, throwIfAborted } from "../utils/cancellation.js";
export function locate(page: Page, target: Target): Locator {
  if ("role" in target) return page.getByRole(target.role, { name: target.name, exact: true });
  if ("label" in target) return page.getByLabel(target.label, { exact: true });
  if ("testId" in target) return page.getByTestId(target.testId);
  return page.locator(target.css);
}
export async function eventually(
  check: () => Promise<boolean>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  do {
    throwIfAborted(signal);
    if (await abortable(check(), signal)) return;
    await pause(Math.max(1, Math.min(80, end - Date.now())), signal);
  } while (Date.now() < end);
  throw new Error("等待预期状态超时");
}
