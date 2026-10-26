import { type Browser, type BrowserContext, chromium, firefox, type Page, webkit } from "playwright";
import type { BrowserEngine, ReviewConfig, Viewport } from "../config.js";
import type { Diagnostic, Report } from "../reports/types.js";
import { abortable, pause, throwIfAborted } from "../utils/cancellation.js";
import { message, redact, redactUrl } from "../utils/safety.js";
import { startEgressProxy } from "./egress-proxy.js";
import { locate } from "./locators.js";
import { NetworkPolicy } from "./network-policy.js";

const engineLabels: Record<BrowserEngine, string> = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};
export async function createSession(config: ReviewConfig, report: Report, signal?: AbortSignal) {
  throwIfAborted(signal);
  const policy = new NetworkPolicy(config);
  await abortable(policy.authorize(config.url), signal);
  let currentViewport = "environment";
  let recording = true;
  const record = (d: Diagnostic) => {
    if (!recording || signal?.aborted) return;
    if (report.diagnostics.length < 500) report.diagnostics.push(d);
    else report.droppedDiagnostics[d.viewport] = (report.droppedDiagnostics[d.viewport] ?? 0) + 1;
  };
  const proxy = await abortable(
    startEgressProxy(policy, (event) =>
      record({
        viewport: currentViewport,
        kind: "blocked",
        message: event.reason,
        url: event.url,
        origin: "environment",
      }),
    ),
    signal,
    (late) => late.close(),
  );
  let browser: Browser;
  try {
    throwIfAborted(signal);
    const proxied = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
      bypass: "<-loopback>",
    };
    const launch = () => {
      if (config.browser === "chromium")
        return chromium.launch({
          headless: true,
          chromiumSandbox: true,
          timeout: config.timeoutMs,
          proxy: proxied,
          args: [
            "--disable-quic",
            "--disable-background-networking",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          ],
        });
      if (config.browser === "firefox") return firefox.launch({ headless: true, timeout: config.timeoutMs });
      return webkit.launch({ headless: true, timeout: config.timeoutMs });
    };
    browser = await abortable(launch(), signal, (late) => late.close());
  } catch (error) {
    recording = false;
    await proxy.close();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const close = () => {
    recording = false;
    closing ??= (async () => {
      try {
        await browser.close({
          reason: signal?.aborted ? "Review cancelled or timed out" : "Review finished",
        });
      } finally {
        await proxy.close();
        signal?.removeEventListener("abort", onAbort);
      }
    })();
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    await close();
    throwIfAborted(signal);
  }
  report.browser = { name: engineLabels[config.browser], version: browser.version() };
  function origin(url?: string): Diagnostic["origin"] {
    if (!url) return "unknown";
    try {
      return new URL(url).origin === new URL(config.url).origin ? "first-party" : "third-party";
    } catch {
      return "unknown";
    }
  }
  async function open(viewport: Viewport): Promise<{ page: Page; context: BrowserContext }> {
    throwIfAborted(signal);
    currentViewport = viewport.name;
    const context = await abortable(
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.touch,
        proxy:
          config.browser === "chromium"
            ? undefined
            : {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password,
                bypass: "<-loopback>",
              },
        serviceWorkers: "block",
        acceptDownloads: false,
        reducedMotion: "reduce",
      }),
      signal,
      (late) => late.close(),
    );
    context.setDefaultTimeout(config.timeoutMs);
    context.setDefaultNavigationTimeout(config.timeoutMs);
    await context.routeWebSocket("**/*", (ws) => {
      record({
        viewport: viewport.name,
        kind: "blocked",
        url: redactUrl(ws.url()),
        message: "当前版本禁用 WebSocket；依赖实时连接的功能未完整验证",
        origin: "environment",
      });
      ws.close();
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      try {
        await policy.authorize(url);
        await route.continue();
      } catch (error) {
        record({
          viewport: viewport.name,
          kind: "blocked",
          message: message(error),
          url: redactUrl(url),
          origin: "environment",
        });
        await route.abort("blockedbyclient").catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on("console", (event) => {
      if (event.type() === "error") {
        const url = event.location().url;
        record({
          viewport: viewport.name,
          kind: "console",
          message: redact(event.text()),
          ...(url ? { url: redactUrl(url) } : {}),
          origin: origin(url),
        });
      }
    });
    page.on("pageerror", (error) =>
      record({ viewport: viewport.name, kind: "pageerror", message: message(error), origin: "unknown" }),
    );
    page.on("requestfailed", (request) =>
      record({
        viewport: viewport.name,
        kind: "requestfailed",
        message: redact(request.failure()?.errorText ?? "请求失败"),
        url: redactUrl(request.url()),
        origin: origin(request.url()),
      }),
    );
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const headers = response.headers();
      const proxyChallenge =
        response.status() === 407 && (headers["proxy-authenticate"] ?? "").includes('realm="AestheticFlow"');
      if (proxyChallenge) return;
      record({
        viewport: viewport.name,
        kind: "http",
        message: `HTTP ${response.status()} ${response.request().resourceType()}`,
        url: redactUrl(response.url()),
        origin: origin(response.url()),
      });
    });
    page.on("dialog", (dialog) => {
      record({
        viewport: viewport.name,
        kind: "environment",
        message: "原生浏览器对话框已自动取消；其流程未验证",
        origin: "environment",
      });
      void dialog.dismiss().catch(() => {});
    });
    page.on("popup", (popup) => {
      record({
        viewport: viewport.name,
        kind: "environment",
        message: "新窗口已关闭；当前版本不验证弹出窗口流程",
        origin: "environment",
      });
      void popup.close().catch(() => {});
    });
    page.on("download", (download) => {
      record({
        viewport: viewport.name,
        kind: "environment",
        message: "文件下载被取消；不验证下载内容",
        origin: "environment",
      });
      void download.cancel().catch(() => {});
    });
    return { page, context };
  }
  return { open, close };
}
export async function navigate(page: Page, config: ReviewConfig, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const response = await abortable(page.goto(config.url, { waitUntil: "domcontentloaded", signal }), signal);
  if (!response || response.status() >= 400)
    throw new Error(`导航未成功，HTTP ${response?.status() ?? "no-response"}`);
  if (config.waitFor)
    await abortable(locate(page, config.waitFor).waitFor({ state: "visible", signal }), signal);
  await abortable(
    page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
    }),
    signal,
  );
  if (config.waitMs) await pause(config.waitMs, signal);
}
