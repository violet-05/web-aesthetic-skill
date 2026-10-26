import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
export function safeSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "page"
  );
}
export function within(root: string, candidate: string): string {
  const full = resolve(root, candidate);
  const r = relative(resolve(root), full);
  if (r === ".." || r.startsWith("..\\") || r.startsWith("../") || isAbsolute(r))
    throw new Error("输出路径越界");
  return full;
}
export async function createRunDirectory(output: string): Promise<{ directory: string; runId: string }> {
  const outputRoot = resolve(output);
  await mkdir(outputRoot, { recursive: true });
  const realRoot = await realpath(outputRoot);
  const runId = `review-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = within(realRoot, runId);
  await mkdir(directory);
  await mkdir(within(directory, "screenshots"));
  await mkdir(within(directory, "diagnostics"));
  return { directory, runId };
}
export function redactUrl(value: string): string {
  try {
    const u = new URL(value);
    u.username = "";
    u.password = "";
    u.hash = "";
    if (u.search) u.search = "?redacted";
    return u.toString();
  } catch {
    return "[invalid URL]";
  }
}
export function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/g, redactUrl)
    .replace(/((?:authorization|password|secret|token|api[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]")
    .slice(0, 4000);
}
export function message(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}
