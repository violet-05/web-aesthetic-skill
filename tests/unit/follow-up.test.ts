import assert from "node:assert/strict";
import { test } from "node:test";
import { configSchema } from "../../src/config.js";
import { compareReports } from "../../src/reports/compare.js";
import { verificationProfile } from "../../src/reports/profile.js";
import {
  abortable,
  createReviewDeadline,
  pause,
  ReviewCancelledError,
  ReviewTimeoutError,
} from "../../src/utils/cancellation.js";

const basic = { url: "http://127.0.0.1:3000" };
test("follow-up options are strict, bounded and default to no extra scrolling or captures", () => {
  const c = configSchema.parse(basic);
  assert.equal(c.reviewTimeoutMs, 120000);
  assert.equal(c.lazyLoad.enabled, false);
  assert.equal(c.stepScreenshots.mode, "none");
  for (const invalid of [
    { reviewTimeoutMs: 0 },
    { reviewTimeoutMs: 600001 },
    { lazyLoad: { maxScrolls: 41 } },
    { lazyLoad: { maxDurationMs: 0 } },
    { lazyLoad: { waitMs: 0 } },
    { stepScreenshots: { maxPerViewport: 81 } },
    { stepScreenshots: { mode: "always" } },
    { lazyLoad: { enable: true } },
  ])
    assert.throws(() => configSchema.parse({ ...basic, ...invalid }));
  assert.equal(configSchema.parse({ ...basic, lazyLoad: { enabled: true } }).lazyLoad.maxScrolls, 12);
});
test("verification fingerprint includes scroll, screenshot and time budgets", () => {
  const original = verificationProfile(configSchema.parse(basic));
  for (const changed of [
    { lazyLoad: { enabled: true } },
    { lazyLoad: { maxScrolls: 2 } },
    { stepScreenshots: { mode: "all" } },
    { stepScreenshots: { maxPerViewport: 2 } },
    { reviewTimeoutMs: 5000 },
  ])
    assert.notEqual(verificationProfile(configSchema.parse({ ...basic, ...changed })), original);
  assert.equal(
    verificationProfile(configSchema.parse({ ...basic, output: "elsewhere", project: "rename" })),
    original,
  );
});
test("deadline and caller cancellation have distinguishable reasons", async () => {
  const deadline = createReviewDeadline(20);
  try {
    await assert.rejects(pause(200, deadline.signal), ReviewTimeoutError);
  } finally {
    deadline.dispose();
  }
  const caller = new AbortController(),
    cancelled = createReviewDeadline(10000, caller.signal);
  caller.abort();
  try {
    assert.ok(cancelled.signal.reason instanceof ReviewCancelledError);
    await assert.rejects(pause(1, cancelled.signal), ReviewCancelledError);
  } finally {
    cancelled.dispose();
  }
});
test("aborted resource acquisition disposes a late result without unhandled rejection", async () => {
  const controller = new AbortController();
  let dispose = false;
  const result = abortable(
    pause(40).then(() => ({ resource: true })),
    controller.signal,
    async (value) => {
      dispose = value.resource;
    },
  );
  controller.abort(new ReviewCancelledError());
  await assert.rejects(result, ReviewCancelledError);
  await pause(70);
  assert.equal(dispose, true);
});
test("abortable consumes late failure and disposed timers do not cancel finished work", async () => {
  const c = new AbortController();
  const pending = abortable(
    pause(30).then(() => {
      throw new Error("late");
    }),
    c.signal,
  );
  c.abort(new ReviewCancelledError());
  await assert.rejects(pending, ReviewCancelledError);
  await pause(45);
  const deadline = createReviewDeadline(10);
  deadline.dispose();
  await pause(25);
  assert.equal(deadline.signal.aborted, false);
});
test("comparison keeps legacy reports readable but refuses mixed versions", () => {
  const legacy = {
    schemaVersion: "1.0",
    runId: "old",
    verificationProfile: "legacy",
    targetUrl: basic.url,
    viewports: [],
    checks: [],
    issues: [],
    config: { maxIterations: 3 },
  };
  assert.equal(compareReports(legacy, legacy).stopReason, "continue-review");
  assert.throws(() => compareReports(legacy, { ...legacy, schemaVersion: "1.1" }), /schema/);
});

test("timed-out execution cannot claim earlier disappeared issues are verified fixes", () => {
  const baseline = {
    schemaVersion: "1.1",
    runId: "a",
    verificationProfile: "same",
    targetUrl: basic.url,
    viewports: [{ name: "mobile", width: 390, height: 844 }],
    checks: [{ id: "layout.overflow", viewport: "mobile", status: "fail" }],
    issues: [
      { fingerprint: "f", ruleId: "layout.overflow", viewport: "mobile", priority: "P1", title: "overflow" },
    ],
    config: { maxIterations: 3 },
  };
  const after = {
    ...baseline,
    runId: "b",
    issues: [],
    execution: { status: "timed-out" },
    checks: [{ id: "layout.overflow", viewport: "mobile", status: "pass" }],
  };
  const diff = compareReports(baseline, after);
  assert.equal(diff.fixed.length, 0);
  assert.equal(diff.unverified.length, 1);
  assert.equal(diff.stopReason, "continue-review");
});
test("incomplete evidence cannot produce automated-gates-clear", () => {
  const baseReport = {
    schemaVersion: "1.1",
    runId: "a",
    verificationProfile: "same",
    targetUrl: basic.url,
    viewports: [{ name: "mobile", width: 390, height: 844 }],
    issues: [],
    config: { maxIterations: 3 },
    execution: { status: "completed" },
    checks: [
      { id: "layout.overflow", viewport: "mobile", status: "pass" },
      { id: "layout.content", viewport: "mobile", status: "pass" },
      { id: "interaction.task", viewport: "mobile", status: "pass" },
      { id: "screenshots.step-coverage", viewport: "mobile", status: "unknown" },
    ],
  };
  assert.equal(compareReports(baseReport, baseReport).stopReason, "continue-review");
});
