import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startEgressProxy } from "../../src/browser/egress-proxy.js";
import { NetworkPolicy } from "../../src/browser/network-policy.js";
import { configSchema } from "../../src/config.js";
import { review } from "../../src/reviewer.js";
import { startFixtureServer } from "../fixtures/server.js";

test("real Chromium: three viewports, PNG evidence, menus/dialog/forms/navigation/keyboard", {
  timeout: 120000,
}, async () => {
  const server = await startFixtureServer(),
    output = await mkdtemp(join(tmpdir(), "aesthetic-good-"));
  try {
    const demo = JSON.parse(await readFile("templates/demo-review.json", "utf8"));
    const config = configSchema.parse({
      ...demo,
      url: `${server.url}/good`,
      output,
      timeoutMs: 3000,
      waitMs: 80,
    });
    const { report, directory } = await review(config);
    assert.equal(report.summary.failed, 0, JSON.stringify(report.issues));
    assert.equal(
      report.summary.errors,
      0,
      JSON.stringify(
        report.checks.filter((check) => check.status === "error"),
        null,
        2,
      ),
    );
    assert.equal(report.issues.length, 0);
    assert.equal(report.status, "incomplete");
    assert.equal(report.screenshots.length, 18);
    assert.notEqual(report.browser.version, "not-started");
    for (const view of config.viewports) {
      assert.equal(
        report.checks.find((c) => c.viewport === view.name && c.id === "layout.overflow")?.status,
        "pass",
      );
      assert.equal(
        report.checks.filter(
          (c) => c.viewport === view.name && c.id.startsWith("interaction.") && c.status === "pass",
        ).length,
        5,
      );
    }
    const screenshot = report.screenshots[0];
    assert.ok(screenshot);
    const png = await readFile(join(directory, screenshot.path));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), screenshot.width);
    assert.equal(png.readUInt32BE(20), screenshot.height);
    const json = JSON.parse(await readFile(join(directory, "report.json"), "utf8"));
    assert.equal(json.schemaVersion, "1.1");
    assert.equal(json.summary.aestheticScore, null);
    assert.ok((await readFile(join(directory, "report.html"), "utf8")).includes("实际截图"));
    assert.ok((await readFile(join(directory, "metadata.json"), "utf8")).includes("Chromium"));
  } finally {
    await server.close();
  }
});
test("known defects detected with evidence, failed steps, focus heuristic and runtime provenance", {
  timeout: 120000,
}, async () => {
  const server = await startFixtureServer(),
    output = await mkdtemp(join(tmpdir(), "aesthetic-broken-"));
  try {
    const template = JSON.parse(await readFile("templates/broken-review.json", "utf8"));
    const { report } = await review(
      configSchema.parse({ ...template, url: `${server.url}/broken`, output, timeoutMs: 600, waitMs: 100 }),
    );
    for (const viewport of ["desktop", "tablet", "mobile"]) {
      for (const rule of ["layout.overflow", "images.loaded", "runtime.errors", "interaction.save-draft"])
        assert.equal(
          report.checks.find((c) => c.id === rule && c.viewport === viewport)?.status,
          "fail",
          `${rule} ${viewport}`,
        );
      assert.equal(
        report.checks.find((c) => c.id === "a11y.focus.keyboard-focus" && c.viewport === viewport)?.status,
        "unknown",
      );
    }
    const overflow = report.checks.find((c) => c.id === "layout.overflow" && c.viewport === "mobile");
    assert.ok(overflow);
    assert.ok(Number(overflow.evidence.documentWidth) > Number(overflow.evidence.viewportWidth));
    assert.ok(report.diagnostics.some((d) => d.kind === "console" && d.message.includes("Intentional")));
    assert.ok(report.diagnostics.some((d) => d.kind === "pageerror"));
    assert.ok(report.diagnostics.some((d) => d.kind === "http" && d.message.includes("404")));
    assert.ok(report.issues.every((i) => i.suggestion.length > 10));
  } finally {
    await server.close();
  }
});
test("redirect cannot reach a different local origin or metadata address", { timeout: 60000 }, async () => {
  const server = await startFixtureServer(),
    other = await startFixtureServer(),
    output = await mkdtemp(join(tmpdir(), "aesthetic-redirect-"));
  try {
    for (const destination of [`${other.url}/secret`, "http://169.254.169.254/latest/meta-data/"]) {
      const { report } = await review(
        configSchema.parse({
          url: `${server.url}/redirect?to=${encodeURIComponent(destination)}`,
          output,
          viewports: [{ name: "mobile", width: 390, height: 844 }],
          timeoutMs: 1000,
        }),
      );
      assert.equal(report.checks.find((c) => c.id === "navigation")?.status, "fail");
      assert.ok(report.diagnostics.some((d) => d.kind === "blocked"));
      assert.ok(report.checks.some((c) => c.id === "images.loaded" && c.status === "skipped"));
    }
    assert.equal(other.blockedHits, 0);
  } finally {
    await server.close();
    await other.close();
  }
});
test("empty page is a measured P0 and unconfigured interactions are skipped", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer(),
    output = await mkdtemp(join(tmpdir(), "aesthetic-empty-"));
  try {
    const { report } = await review(
      configSchema.parse({
        url: `${server.url}/empty`,
        output,
        viewports: [{ name: "mobile", width: 390, height: 844 }],
        waitMs: 0,
      }),
    );
    assert.ok(report.issues.some((i) => i.ruleId === "layout.content" && i.priority === "P0"));
    assert.equal(report.checks.find((c) => c.id === "interaction.unconfigured")?.status, "skipped");
  } finally {
    await server.close();
  }
});
test("server offline yields actual failure and no fabricated screenshot", { timeout: 30000 }, async () => {
  const server = await startFixtureServer();
  await server.close();
  const { report } = await review(
    configSchema.parse({
      url: `${server.url}/good`,
      output: await mkdtemp(join(tmpdir(), "aesthetic-offline-")),
      viewports: [{ name: "mobile", width: 390, height: 844 }],
      timeoutMs: 600,
    }),
  );
  assert.equal(report.screenshots.length, 0);
  assert.ok(report.issues.some((i) => i.priority === "P0"));
  assert.ok(report.checks.some((c) => c.status === "skipped"));
});
test("egress proxy connects to the authorized pinned IP, never performs a second DNS lookup", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  let calls = 0;
  const url = server.url.replace("127.0.0.1", "localhost");
  const policy = new NetworkPolicy({ url, allowOrigins: [], allowPrivateNetwork: false }, async () => {
    calls++;
    return [{ address: "127.0.0.1", family: 4 }];
  });
  const proxy = await startEgressProxy(policy, () => {});
  try {
    const p = new URL(proxy.server);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.get(
        {
          host: p.hostname,
          port: p.port,
          path: `${url}/good`,
          headers: {
            "Proxy-Authorization": `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}`,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
    });
    assert.equal(status, 200);
    assert.equal(calls, 1);
  } finally {
    await proxy.close();
    await server.close();
  }
});

test("isolated fixture defects trigger their own rule without unrelated failures", {
  timeout: 90000,
}, async () => {
  const server = await startFixtureServer(),
    output = await mkdtemp(join(tmpdir(), "aesthetic-isolated-"));
  try {
    for (const [route, rule] of [
      ["overflow", "layout.overflow"],
      ["broken-image", "images.loaded"],
      ["console-error", "runtime.errors"],
    ] as const) {
      const { report } = await review(
        configSchema.parse({
          url: `${server.url}/cases/${route}`,
          output,
          viewports: [{ name: "mobile", width: 390, height: 844 }],
          waitMs: 30,
          timeoutMs: 1000,
        }),
      );
      assert.equal(report.checks.find((c) => c.id === rule)?.status, "fail");
      assert.equal(report.summary.errors, 0);
      if (route !== "overflow")
        assert.equal(report.checks.find((c) => c.id === "layout.overflow")?.status, "pass");
    }
    const { report } = await review(
      configSchema.parse({
        url: `${server.url}/cases/mobile-layout`,
        output,
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 390, height: 844 },
        ],
        waitMs: 30,
        timeoutMs: 1000,
      }),
    );
    assert.equal(
      report.checks.find((c) => c.id === "layout.overflow" && c.viewport === "desktop")?.status,
      "pass",
    );
    assert.equal(
      report.checks.find((c) => c.id === "layout.overflow" && c.viewport === "mobile")?.status,
      "fail",
    );
  } finally {
    await server.close();
  }
});
test("action-only scenario is unknown and subsequent steps after a failed assertion are skipped", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        url: `${server.url}/cases/dead-button`,
        output: await mkdtemp(join(tmpdir(), "aesthetic-actions-")),
        viewports: [{ name: "mobile", width: 390, height: 844 }],
        timeoutMs: 500,
        waitMs: 0,
        interactions: [
          { name: "action-only", steps: [{ action: "click", target: { css: "#save" } }] },
          {
            name: "explicit-result",
            steps: [
              { action: "click", target: { css: "#save" } },
              { action: "expectText", target: { css: "#result" }, text: "成功" },
              { action: "click", target: { css: "#save" } },
            ],
          },
        ],
      }),
    );
    assert.equal(report.checks.find((c) => c.id === "interaction.action-only")?.status, "unknown");
    const failed = report.checks.find((c) => c.id === "interaction.explicit-result");
    assert.equal(failed?.status, "fail");
    const steps = failed?.evidence.steps as Array<{ status: string }>;
    assert.equal(steps[2]?.status, "skipped");
  } finally {
    await server.close();
  }
});

test("CSS-only artwork stays unknown rather than being mislabeled blank", { timeout: 30000 }, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        url: `${server.url}/blank-css`,
        output: await mkdtemp(join(tmpdir(), "aesthetic-css-")),
        viewports: [{ name: "mobile", width: 390, height: 844 }],
        waitMs: 0,
      }),
    );
    assert.equal(report.checks.find((c) => c.id === "layout.content")?.status, "unknown");
    assert.ok(!report.issues.some((i) => i.ruleId === "layout.content"));
  } finally {
    await server.close();
  }
});
test("diagnostic cap never turns unobserved later-viewport errors into pass", {
  timeout: 30000,
}, async () => {
  const server = await startFixtureServer();
  try {
    const { report } = await review(
      configSchema.parse({
        url: `${server.url}/cases/diagnostic-flood`,
        output: await mkdtemp(join(tmpdir(), "aesthetic-cap-")),
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 390, height: 844 },
        ],
        waitMs: 30,
      }),
    );
    assert.equal(report.diagnostics.length, 500);
    assert.ok((report.droppedDiagnostics.mobile ?? 0) > 0);
    assert.equal(
      report.checks.find((c) => c.id === "runtime.errors" && c.viewport === "mobile")?.status,
      "unknown",
    );
    assert.equal(
      report.checks.find((c) => c.id === "diagnostics.completeness" && c.viewport === "mobile")?.status,
      "unknown",
    );
  } finally {
    await server.close();
  }
});
