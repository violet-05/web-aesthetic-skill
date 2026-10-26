import assert from "node:assert/strict";
import { test } from "node:test";
import { NetworkPolicy, parseHttpUrl } from "../../src/browser/network-policy.js";
import { configSchema, parseViewports } from "../../src/config.js";
import { checkSkill } from "../../src/project.js";
import { Collector } from "../../src/reports/collector.js";
import { compareReports } from "../../src/reports/compare.js";
import { escapeHtml, renderHtml } from "../../src/reports/html-reporter.js";
import { summarize } from "../../src/reports/summary.js";
import { priorityAtLeast, type Report } from "../../src/reports/types.js";
import { redact, redactUrl, safeSlug, within } from "../../src/utils/safety.js";

const config = configSchema.parse({ url: "http://127.0.0.1:3000" });
function blank(): Report {
  return {
    schemaVersion: "1.0",
    runId: "r1",
    verificationProfile: "unit-test-profile",
    project: "test",
    targetUrl: config.url,
    startedAt: "2026-10-26",
    finishedAt: "2026-10-26",
    browser: { name: "Chromium", version: "test" },
    viewports: config.viewports,
    status: "incomplete",
    checks: [],
    issues: [],
    diagnostics: [],
    droppedDiagnostics: {},
    screenshots: [],
    summary: {
      executed: 0,
      total: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      skipped: 0,
      errors: 0,
      coverage: 0,
      byPriority: { P0: 0, P1: 0, P2: 0, P3: 0 },
      aestheticScore: null,
    },
    dimensions: [],
    config: { maxIterations: 3, designGoals: [] },
    limitations: [],
  };
}
test("strict configuration defaults, bounds and typos", () => {
  assert.equal(config.viewports.length, 3);
  assert.equal(config.maxIterations, 3);
  for (const patch of [
    { timeotMs: 1 },
    { timeoutMs: 100000 },
    { maxIterations: 0 },
    { viewports: [] },
    { viewports: [{ name: "../x", width: 390, height: 844 }] },
    { interactions: [{ name: "x", steps: [{ action: "evaluate", code: "bad" }] }] },
  ])
    assert.throws(() => configSchema.parse({ url: config.url, ...patch }));
  assert.throws(() =>
    configSchema.parse({ url: config.url, viewports: [config.viewports[0], config.viewports[0]] }),
  );
  assert.throws(() => configSchema.parse({ url: config.url, allowPrivateNetwork: "true" }));
});
test("viewport parser accepts dimensions and rejects malformed/resource-heavy input", () => {
  assert.equal(parseViewports("1440x900,390x844")[1]?.width, 390);
  for (const input of ["x", "390X844", "0x900", "9999x9999", "390x844,", "390x844;rm"])
    assert.throws(() => parseViewports(input));
});
test("URL protocols, credentials and malformed values rejected", () => {
  for (const raw of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://localhost",
    "http://u:p@localhost",
    "not-a-url",
  ])
    assert.throws(() => parseHttpUrl(raw));
  assert.equal(parseHttpUrl(config.url).port, "3000");
});
test("exact origin default, explicit remote and port boundary", async () => {
  const policy = new NetworkPolicy(config);
  await policy.authorize(config.url);
  await assert.rejects(policy.authorize("http://127.0.0.1:3001"));
  assert.throws(() => new NetworkPolicy({ ...config, url: "https://example.com" }));
  const remote = new NetworkPolicy(
    { ...config, url: "https://example.com", allowOrigins: ["https://example.com"] },
    async () => [{ address: "93.184.216.34", family: 4 }],
  );
  await remote.authorize("https://example.com/a");
  await assert.rejects(remote.authorize("https://example.com.evil.test"));
  assert.throws(() => new NetworkPolicy({ ...config, allowOrigins: ["https://example.com/path"] }));
});
test("metadata/link-local/multicast/reserved/mapped IP denied even with opt-in", async () => {
  for (const host of [
    "169.254.169.254",
    "169.254.170.2",
    "0.0.0.0",
    "224.0.0.1",
    "100.100.100.200",
    "[fe80::1]",
    "[::ffff:169.254.169.254]",
    "metadata.google.internal",
  ]) {
    const url = `http://${host}`;
    const policy = new NetworkPolicy(
      { ...config, url, allowOrigins: [url], allowPrivateNetwork: true },
      async () => [{ address: "169.254.169.254", family: 4 }],
    );
    await assert.rejects(policy.authorize(url));
  }
});
test("private networks require both origin and explicit private opt-in", async () => {
  const url = "http://192.168.1.20:3000";
  const denied = new NetworkPolicy({ ...config, url, allowOrigins: [url] });
  await assert.rejects(denied.authorize(url));
  await new NetworkPolicy({ ...config, url, allowOrigins: [url], allowPrivateNetwork: true }).authorize(url);
});
test("DNS all results checked, rebinding to loopback denied", async () => {
  const remote = {
    ...config,
    url: "https://example.com",
    allowOrigins: ["https://example.com"],
    allowPrivateNetwork: true,
  };
  const policy = new NetworkPolicy(remote, async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await assert.rejects(policy.authorize(remote.url));
  let n = 0;
  const changing = new NetworkPolicy(remote, async () => [
    { address: n++ ? "127.0.0.1" : "93.184.216.34", family: 4 },
  ]);
  await changing.authorize(remote.url);
  await assert.rejects(changing.authorize(remote.url));
});
test("safe filenames and containment", () => {
  assert.equal(safeSlug("../../a b?token=1"), "a-b-token-1");
  assert.equal(safeSlug("中文"), "page");
  assert.throws(() => within(process.cwd(), "../../outside"));
  assert.ok(within(process.cwd(), "screenshots/file.png").endsWith("file.png"));
});
test("diagnostic URL queries and common credentials are redacted", () => {
  assert.equal(redactUrl("https://u:p@example.com/x?token=secret#hash"), "https://example.com/x?redacted");
  assert.ok(!redact("token=abc https://example.com/?key=xyz").includes("abc"));
  assert.ok(!redact("token=abc https://example.com/?key=xyz").includes("xyz"));
});
test("priority threshold is ordered, none disables finding failures", () => {
  assert.equal(priorityAtLeast("P0", "P1"), true);
  assert.equal(priorityAtLeast("P2", "P1"), false);
  assert.equal(priorityAtLeast("P0", "none"), false);
});
test("coverage excludes unknown, skipped and error; aesthetic score stays null", () => {
  const r = blank();
  const c = new Collector(r);
  for (const status of ["pass", "fail", "unknown", "skipped", "error"] as const)
    c.check("mobile", status, "layout", status, "test");
  summarize(r, config);
  assert.equal(r.summary.coverage, 40);
  assert.equal(r.summary.passed, 1);
  assert.equal(r.summary.executed, 2);
  assert.equal(r.summary.aestheticScore, null);
  assert.equal(r.status, "error");
  assert.ok(r.dimensions.every((d) => d.score === null));
});
test("issue fingerprints stable and duplicate rule findings coalesced", () => {
  const r = blank(),
    c = new Collector(r);
  const check = c.check("mobile", "overflow", "layout", "fail", "test");
  const a = c.issue(check, "P1", "x", "fix");
  const b = c.issue(check, "P1", "x", "fix");
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(r.issues.length, 1);
});
test("HTML escapes every untrusted text field and rejects screenshot path injection", () => {
  const r = blank();
  r.project = "<script>alert(1)</script>";
  r.targetUrl = "javascript:alert(1)";
  r.screenshots.push({
    path: '" onerror="alert(1)',
    viewport: "x",
    width: 390,
    height: 844,
    phase: "baseline",
    capturedAt: "",
    truncated: false,
  });
  const c = new Collector(r);
  c.issue(
    c.check("x", "x", "layout", "fail", "x", { html: "<img onerror=alert(1)>" }),
    "P1",
    "</h3><script>bad</script>",
    "fix",
  );
  summarize(r, config);
  const html = renderHtml(r);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('onerror="alert'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.equal(escapeHtml('"<&'), "&quot;&lt;&amp;");
});
test("compare does not call disappearance a fix without pass evidence", () => {
  const before = blank();
  const c = new Collector(before);
  c.issue(c.check("mobile", "layout.overflow", "responsive", "fail", "overflow"), "P1", "overflow", "fix");
  const after = blank();
  after.runId = "r2";
  assert.ok(before.checks[0]);
  after.checks.push({ ...before.checks[0], status: "skipped" });
  const diff = compareReports(before, after);
  assert.equal(diff.fixed.length, 0);
  assert.equal(diff.unverified.length, 1);
  assert.ok(after.checks[0]);
  after.checks[0].status = "pass";
  assert.equal(compareReports(before, after).fixed.length, 1);
  assert.equal(compareReports(before, after, 3).stopReason, "max-iterations");
  assert.throws(() => compareReports(before, { ...after, targetUrl: "http://other.test" }));
  assert.throws(() => compareReports({}, {}));
});
test("compare reports newly failed and lost checks as regressions", () => {
  const before = blank(),
    after = blank();
  new Collector(before).check("mobile", "test", "layout", "pass", "test");
  const result = compareReports(before, after);
  assert.equal(result.regressions.length, 1);
  assert.equal(result.stopReason, "continue-review");
});
test("skill package has valid metadata, actual resources and working reference links", async () => {
  const result = await checkSkill();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("compare rejects different verification settings even if target and rule names match", () => {
  const before = blank(),
    after = blank();
  after.verificationProfile = "changed";
  assert.throws(() => compareReports(before, after), /检查配置已改变/);
});
