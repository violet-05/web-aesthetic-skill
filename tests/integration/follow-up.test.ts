import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { prepareLazyImages } from "../../src/browser/lazy-load.js";
import { configSchema } from "../../src/config.js";
import { review } from "../../src/reviewer.js";
import { pause } from "../../src/utils/cancellation.js";
import { startFixtureServer } from "../fixtures/server.js";

const mobile = { name: "mobile", width: 390, height: 844 };
const base = { viewports: [mobile], waitMs: 50, timeoutMs: 1500 };
const engineNames = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" } as const;
async function output() {
  return mkdtemp(join(tmpdir(), "aesthetic-followup-"));
}

test("bounded lazy loading turns an unloaded real observer image into measured loaded evidence", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const raw = { ...base, url: `${server.url}/lazy`, output: await output() };
    const before = await review(configSchema.parse(raw));
    assert.equal(before.report.checks.find((c) => c.id === "images.loaded")?.status, "unknown");
    const after = await review(
      configSchema.parse({
        ...raw,
        lazyLoad: { enabled: true, maxScrolls: 12, waitMs: 80, maxDurationMs: 3000 },
      }),
    );
    const prep = after.report.checks.find((c) => c.id === "images.lazy-load");
    assert.equal(prep?.status, "pass");
    assert.equal(prep.evidence.stopReason, "bottom-stable");
    assert.equal(prep.evidence.restored, true);
    assert.equal(after.report.checks.find((c) => c.id === "images.loaded")?.status, "pass");
    assert.equal(after.report.summary.errors, 0);
    assert.ok(
      (await readFile(join(after.directory, "diagnostics/lazy-load-results.json"), "utf8")).includes(
        "bottom-stable",
      ),
    );
  } finally {
    await server.close();
  }
});
for (const engine of ["chromium", "firefox", "webkit"] as const)
  test(`review runs against the real ${engine} engine`, { timeout: 30000 }, async () => {
    const server = await startFixtureServer();
    try {
      const { report } = await review(
        configSchema.parse({
          ...base,
          browser: engine,
          url: `${server.url}/good`,
          output: await output(),
          timeoutMs: 10000,
        }),
      );
      assert.equal(report.browser.name, engineNames[engine]);
      assert.notEqual(report.browser.version, "not-started");
      assert.equal(report.execution?.status, "completed");
      assert.equal(report.screenshots.length, 1);
      assert.equal(report.summary.errors, 0);
      assert.equal(report.checks.find((check) => check.id === "navigation")?.status, "pass");
      assert.equal(report.diagnostics.length, 0);
    } finally {
      await server.close();
    }
  });
test("touch viewport enables a real tap interaction and reports the pointer source", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/touch-target`,
        output: await output(),
        viewports: [{ ...mobile, touch: true }],
        interactions: [
          {
            name: "touch",
            steps: [
              { action: "tap", target: { css: "#touch-target" } },
              { action: "expectText", target: { css: "#touch-status" }, text: "pointer:touch" },
            ],
          },
        ],
      }),
    );
    const interaction = report.checks.find((check) => check.id === "interaction.touch");
    assert.ok(interaction);
    assert.equal(interaction?.status, "pass");
    assert.equal(
      (interaction.evidence.steps as Array<{ evidence?: { action?: string } }>)[0]?.evidence?.action,
      "tap",
    );
    assert.equal(report.viewports[0]?.touch, true);
  } finally {
    await server.close();
  }
});
test("tap on a non-touch viewport fails explicitly instead of falling back to click", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/touch-target`,
        output: await output(),
        interactions: [
          {
            name: "touch-required",
            steps: [{ action: "tap", target: { css: "#touch-target" } }],
          },
        ],
      }),
    );
    const interaction = report.checks.find((check) => check.id === "interaction.touch-required");
    assert.ok(interaction);
    assert.equal(interaction?.status, "fail");
    assert.match(String((interaction.evidence.steps as Array<{ error?: string }>)[0]?.error), /touch: true/);
  } finally {
    await server.close();
  }
});
test("nested scroll containers are optional and can trigger their own lazy content", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/nested-scroll`,
        output: await output(),
        lazyLoad: {
          enabled: true,
          maxScrolls: 12,
          waitMs: 60,
          maxDurationMs: 4000,
          scrollContainers: { enabled: true, maxContainers: 4 },
        },
      }),
    );
    const prep = report.checks.find((check) => check.id === "images.lazy-load");
    assert.equal(prep?.status, "pass");
    assert.equal(prep.evidence.containerScan, "enabled");
    assert.equal(prep.evidence.detectedContainers, 1);
    assert.equal(prep.evidence.restored, true);
    assert.equal(
      (prep.evidence.containers as Array<{ complete: boolean; restored: boolean }>)[0]?.complete,
      true,
    );
    assert.equal(
      (prep.evidence.containers as Array<{ complete: boolean; restored: boolean }>)[0]?.restored,
      true,
    );
    assert.equal(report.checks.find((check) => check.id === "images.loaded")?.status, "pass");
  } finally {
    await server.close();
  }
});
test("an infinite nested list stays unknown when the shared scroll cap is reached", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/nested-infinite`,
        output: await output(),
        lazyLoad: {
          enabled: true,
          maxScrolls: 2,
          waitMs: 40,
          maxDurationMs: 3000,
          scrollContainers: { enabled: true, maxContainers: 4 },
        },
      }),
    );
    const prep = report.checks.find((check) => check.id === "images.lazy-load");
    assert.equal(prep?.status, "unknown");
    assert.equal(prep.evidence.stopReason, "max-scrolls");
    assert.equal((prep.evidence.containers as Array<{ stopReason: string }>)[0]?.stopReason, "max-scrolls");
  } finally {
    await server.close();
  }
});
test("scroll cap leaves unseen content unknown instead of promising whole-page coverage", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/lazy`,
        output: await output(),
        lazyLoad: { enabled: true, maxScrolls: 1, waitMs: 40, maxDurationMs: 3000 },
      }),
    );
    const prep = report.checks.find((c) => c.id === "images.lazy-load");
    assert.equal(prep?.status, "unknown");
    assert.equal(prep.evidence.stopReason, "max-scrolls");
    assert.equal(prep.evidence.scrolls, 1);
    assert.equal(report.checks.find((c) => c.id === "images.loaded")?.status, "unknown");
  } finally {
    await server.close();
  }
});
test("infinite scrolling and finite image waits stop within bounded budgets", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${server.url}/cases/infinite-scroll`);
    const started = Date.now();
    const result = await prepareLazyImages(page, {
      enabled: true,
      maxScrolls: 40,
      waitMs: 80,
      maxDurationMs: 350,
    });
    assert.equal(result.stopReason, "time-budget");
    assert.equal(result.complete, false);
    assert.ok(Date.now() - started < 3000);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.goto(`${server.url}/lazy`);
    await page.evaluate(() => scrollTo(0, 100));
    await prepareLazyImages(page, { enabled: true, maxScrolls: 12, waitMs: 50, maxDurationMs: 3000 });
    assert.equal(await page.evaluate(() => scrollY), 100);
  } finally {
    await browser.close();
    await server.close();
  }
});
test("step screenshots record menu open/closed states with unique names and bounded count", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const template = JSON.parse(await readFile("templates/demo-review.json", "utf8"));
    const menu = template.interactions[0];
    const cfg = configSchema.parse({
      ...base,
      url: `${server.url}/good`,
      output: await output(),
      interactions: [menu],
      stepScreenshots: { mode: "all", maxPerViewport: 2 },
    });
    const { report, directory } = await review(cfg);
    const steps = report.screenshots.filter((s) => s.stepIndex !== undefined);
    assert.equal(steps.length, 2);
    assert.equal(report.screenshots.length, 4);
    assert.ok(steps.every((s) => s.scenario === "menu" && s.scope === "viewport"));
    assert.equal(new Set(report.screenshots.map((s) => s.path)).size, 4);
    const check = report.checks.find((c) => c.id === "interaction.menu");
    assert.equal(check?.status, "pass");
    const results = check?.evidence.steps as Array<{ screenshot: { status: string } }>;
    assert.equal(results[0]?.screenshot.status, "pass");
    assert.equal(results[2]?.screenshot.status, "skipped");
    const coverage = report.checks.find((c) => c.id === "screenshots.step-coverage");
    assert.equal(coverage?.status, "unknown");
    assert.equal(coverage.evidence.skipped, menu.steps.length - 2);
    for (const image of steps) {
      const png = await readFile(join(directory, image.path));
      assert.equal(png.readUInt32BE(20), 844);
      assert.ok((await stat(join(directory, image.path))).size > 1000);
    }
  } finally {
    await server.close();
  }
});
test("assertion-only captures retain intermediate dialog state, no colliding baseline scenario filename", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/good`,
        output: await output(),
        stepScreenshots: { mode: "assertions", maxPerViewport: 10 },
        interactions: [
          {
            name: "baseline",
            steps: [
              { action: "click", target: { css: "#open-dialog" } },
              { action: "expectVisible", target: { css: "#about" } },
              { action: "click", target: { css: "#close-dialog" } },
              { action: "expectHidden", target: { css: "#about" } },
            ],
          },
        ],
      }),
    );
    assert.deepEqual(
      report.screenshots.filter((s) => s.stepIndex !== undefined).map((s) => s.stepIndex),
      [1, 3],
    );
    assert.equal(new Set(report.screenshots.map((s) => s.path)).size, 4);
    assert.equal(report.summary.failed, 0);
  } finally {
    await server.close();
  }
});
test("global deadline interrupts a hung renderer, writes partial artifacts and skips remaining viewports", {
  timeout: 20000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const started = Date.now();
    const { report, directory } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/hung-renderer`,
        output: await output(),
        timeoutMs: 10000,
        reviewTimeoutMs: 1200,
        viewports: [mobile, { name: "desktop", width: 1440, height: 900 }],
      }),
    );
    assert.ok(Date.now() - started < 12000);
    assert.equal(report.execution?.status, "timed-out");
    assert.equal(report.status, "error");
    assert.equal(report.screenshots.length, 0);
    assert.equal(report.checks.find((c) => c.id === "review.deadline")?.status, "error");
    assert.equal(
      report.checks.find((c) => c.viewport === "desktop" && c.id === "navigation")?.status,
      "skipped",
    );
    assert.ok(!report.issues.some((i) => i.ruleId === "navigation"));
    const keys = report.checks.map((c) => `${c.viewport}:${c.id}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(
      JSON.parse(await readFile(join(directory, "report.json"), "utf8")).execution.status,
      "timed-out",
    );
  } finally {
    await server.close();
  }
});
test("caller cancellation keeps completed work, prevents subsequent actions and does not leak report mutations", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  const controller = new AbortController();
  let delayed: ReturnType<typeof setTimeout> | undefined;
  const poll = setInterval(() => {
    if (server.signals["/signals/start"] && !delayed) delayed = setTimeout(() => controller.abort(), 180);
  }, 10);
  try {
    const { report, directory } = await review(
      configSchema.parse({
        ...base,
        url: `${server.url}/cases/cancel-interaction`,
        output: await output(),
        timeoutMs: 10000,
        interactions: [
          {
            name: "cancel-me",
            steps: [
              { action: "click", target: { css: "#start" } },
              { action: "expectText", target: { css: "#result" }, text: "完成了" },
              { action: "click", target: { css: "#later" } },
            ],
          },
          {
            name: "never-started",
            steps: [
              { action: "click", target: { css: "#later" } },
              { action: "expectVisible", target: { css: "#result" } },
            ],
          },
        ],
      }),
      { signal: controller.signal },
    );
    assert.equal(report.execution?.status, "cancelled");
    assert.equal(report.checks.find((c) => c.id === "navigation")?.status, "pass");
    assert.equal(report.screenshots.length, 1);
    assert.equal(server.signals["/signals/later"] ?? 0, 0);
    const interrupted = report.checks.find((c) => c.id === "interaction.cancel-me");
    assert.equal(interrupted?.status, "error");
    const steps = interrupted?.evidence.steps as Array<{ status: string }>;
    assert.equal(steps[0]?.status, "pass");
    assert.equal(steps[2]?.status, "skipped");
    assert.equal(report.checks.find((c) => c.id === "interaction.never-started")?.status, "skipped");
    assert.ok(!report.issues.some((i) => i.ruleId === "interaction.cancel-me"));
    const snapshot = JSON.stringify(report);
    await pause(200);
    assert.equal(JSON.stringify(report), snapshot);
    assert.equal(
      JSON.parse(await readFile(join(directory, "report.json"), "utf8")).execution.status,
      "cancelled",
    );
  } finally {
    clearInterval(poll);
    if (delayed) clearTimeout(delayed);
    await server.close();
  }
});
test("pre-aborted review does not launch Chromium or fabricate screenshots", { timeout: 30000 }, async () => {
  const c = new AbortController();
  c.abort();
  const { report } = await review(
    configSchema.parse({ ...base, url: "http://127.0.0.1:3000", output: await output() }),
    { signal: c.signal },
  );
  assert.equal(report.execution?.status, "cancelled");
  assert.equal(report.browser.version, "not-started");
  assert.equal(report.screenshots.length, 0);
  assert.equal(report.checks.find((check) => check.id === "navigation")?.status, "skipped");
});
test("CLI timeout returns exit 2 even with fail-on none and prints a real report path", {
  timeout: 20000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const out = await output();
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolveResult) => {
        execFile(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("src/cli.ts"),
            "review",
            "--url",
            `${server.url}/cases/hung-renderer`,
            "--output",
            out,
            "--viewports",
            "390x844",
            "--review-timeout-ms",
            "1200",
            "--timeout-ms",
            "10000",
            "--fail-on",
            "none",
          ],
          { encoding: "utf8", timeout: 15000, windowsHide: true },
          (error, stdout, stderr) =>
            resolveResult({ code: error && "code" in error ? Number(error.code) : 0, stdout, stderr }),
        );
      },
    );
    assert.equal(result.code, 2, result.stderr);
    const cli = JSON.parse(result.stdout);
    assert.equal(cli.execution.status, "timed-out");
    assert.equal(JSON.parse(await readFile(cli.json, "utf8")).execution.status, "timed-out");
  } finally {
    await server.close();
  }
});

test("lazy image sampling cap is unknown, not full completion", { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><body>${Array.from({ length: 201 }, () => '<img width="1" height="1" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">').join("")}</body>`,
    );
    const result = await prepareLazyImages(page, {
      enabled: true,
      maxScrolls: 2,
      waitMs: 30,
      maxDurationMs: 1000,
    });
    assert.equal(result.stopReason, "sample-limit");
    assert.equal(result.complete, false);
  } finally {
    await browser.close();
  }
});
