import { z } from "zod";

const reportSchema = z.object({
  schemaVersion: z.enum(["1.0", "1.1", "1.2", "1.3"]),
  runId: z.string(),
  verificationProfile: z.string(),
  targetUrl: z.string(),
  viewports: z.array(
    z.object({ name: z.string(), width: z.number(), height: z.number(), touch: z.boolean().optional() }),
  ),
  checks: z.array(
    z.object({
      id: z.string(),
      viewport: z.string(),
      status: z.enum(["pass", "fail", "unknown", "skipped", "error"]),
    }),
  ),
  issues: z.array(
    z.object({
      fingerprint: z.string(),
      ruleId: z.string(),
      viewport: z.string(),
      priority: z.enum(["P0", "P1", "P2", "P3"]),
      title: z.string(),
    }),
  ),
  config: z.object({ maxIterations: z.number().int().positive() }),
  execution: z.object({ status: z.enum(["completed", "timed-out", "cancelled", "error"]) }).optional(),
});
export function compareReports(beforeInput: unknown, afterInput: unknown, iteration = 1) {
  const before = reportSchema.parse(beforeInput),
    after = reportSchema.parse(afterInput);
  if (!Number.isInteger(iteration) || iteration < 1) throw new Error("iteration 必须是正整数");
  if (before.schemaVersion !== after.schemaVersion)
    throw new Error("报告 schema 版本不同；升级后请重新建立基线，不跨规则版本认定修复");
  if (before.verificationProfile !== after.verificationProfile)
    throw new Error("检查配置已改变，不能将减少断言或变更等待条件视为修复；请使用相同配置复查");
  if (before.targetUrl !== after.targetUrl) throw new Error("对比目标 URL 不一致");
  const viewportKeys = (v: typeof before.viewports) =>
    v
      .map((x) => `${x.name}:${x.width}x${x.height}:touch=${x.touch === true}`)
      .sort()
      .join("|");
  if (viewportKeys(before.viewports) !== viewportKeys(after.viewports)) throw new Error("对比视口配置不一致");
  const remaining = before.issues.filter((i) => after.issues.some((n) => n.fingerprint === i.fingerprint));
  const disappeared = before.issues.filter((i) => !after.issues.some((n) => n.fingerprint === i.fingerprint));
  const completed = !after.execution || after.execution.status === "completed";
  const fixed = disappeared.filter(
    (i) =>
      completed &&
      after.checks.some((c) => c.id === i.ruleId && c.viewport === i.viewport && c.status === "pass"),
  );
  const unverified = disappeared.filter((i) => !fixed.includes(i));
  const added = after.issues.filter((i) => !before.issues.some((n) => n.fingerprint === i.fingerprint));
  const regressions = before.checks
    .filter((c) => c.status === "pass")
    .filter(
      (c) => !after.checks.some((n) => n.id === c.id && n.viewport === c.viewport && n.status === "pass"),
    );
  const high = after.issues.filter((i) => i.priority === "P0" || i.priority === "P1");
  const interactions = after.checks.filter((c) => c.id.startsWith("interaction."));
  const layouts = after.checks.filter((c) => c.id === "layout.overflow" || c.id === "layout.content");
  const errors = after.checks.some((c) => c.status === "error");
  const automationComplete =
    completed &&
    after.checks
      .filter(
        (c) =>
          !c.id.startsWith("manual.") && !["images.lazy-load", "interaction.unconfigured"].includes(c.id),
      )
      .every((c) => c.status === "pass" || c.status === "fail");
  const stopReason =
    iteration >= after.config.maxIterations
      ? "max-iterations"
      : automationComplete &&
          !high.length &&
          !errors &&
          !added.length &&
          !unverified.length &&
          !regressions.length &&
          interactions.length > 0 &&
          interactions.every((c) => c.status === "pass") &&
          layouts.length >= after.viewports.length * 2 &&
          layouts.every((c) => c.status === "pass")
        ? "automated-gates-clear"
        : "continue-review";
  return {
    schemaVersion: "1.0",
    before: before.runId,
    after: after.runId,
    iteration,
    fixed,
    remaining,
    added,
    unverified,
    regressions,
    stopReason,
    note: "仅比较规则与证据状态，不比较截图像素、不证明审美改善、不自动修改代码。缺失或未完成的复查不能算修复。",
  };
}
