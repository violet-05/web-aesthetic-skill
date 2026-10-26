import { relative } from "node:path";
import type { BrowserEngine } from "../config.js";
import { escapeHtml } from "./html-reporter.js";
import type { Dimension, Issue, Priority, Report, Status } from "./types.js";
export type MatrixExecutionStatus = "completed" | "partial" | "timed-out" | "cancelled" | "error";
export type MatrixRunExecution = NonNullable<Report["execution"]>["status"] | "not-run";
export interface MatrixCheck {
  id: string;
  viewport: string;
  dimension: Dimension;
  status: Status;
  summary: string;
}
export interface MatrixIssue {
  fingerprint: string;
  ruleId: string;
  viewport: string;
  priority: Priority;
  title: string;
  method: Issue["method"];
}
export interface MatrixRun {
  engine: BrowserEngine;
  browser: string;
  version: string;
  directory: string;
  reportPath: string;
  jsonPath: string;
  status: Report["status"] | "not-run" | "error";
  execution: MatrixRunExecution;
  summary: Report["summary"] | null;
  checks: MatrixCheck[];
  issues: MatrixIssue[];
  error?: string;
}
export interface MatrixDivergence {
  key: string;
  id: string;
  viewport: string;
  dimension?: Dimension;
  statuses: Record<BrowserEngine, Status | "not-run">;
  issueEngines: BrowserEngine[];
  highestPriority?: Priority;
  classification: "status-divergence" | "missing-check" | "failure-divergence";
}
export interface MatrixReport {
  schemaVersion: "1.1";
  toolVersion: string;
  runId: string;
  project: string;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  browsers: BrowserEngine[];
  execution: { status: MatrixExecutionStatus; timeoutMs: number; elapsedMs: number };
  status: "pass" | "attention" | "incomplete" | "error";
  runs: MatrixRun[];
  summary: {
    enginesRequested: number;
    enginesCompleted: number;
    enginesPartial: number;
    enginesNotRun: number;
    enginesWithFailures: number;
    checksCompared: number;
    divergentChecks: number;
    failingDivergences: number;
    passAcrossAll: number;
    unknownOnAny: number;
    missingOnAny: number;
  };
  divergences: MatrixDivergence[];
  limitations: string[];
}
const priorityRank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const engineLabels: Record<BrowserEngine, string> = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};
export function matrixRunFromReport(
  engine: BrowserEngine,
  report: Report,
  directory: string,
  matrixDirectory: string,
): MatrixRun {
  const portable = (file: string) => relative(matrixDirectory, file).replaceAll("\\", "/");
  return {
    engine,
    browser: report.browser.name,
    version: report.browser.version,
    directory: portable(directory),
    reportPath: portable(`${directory}/report.html`),
    jsonPath: portable(`${directory}/report.json`),
    status: report.status,
    execution: report.execution?.status ?? "error",
    summary: report.summary,
    checks: report.checks.map((check) => ({
      id: check.id,
      viewport: check.viewport,
      dimension: check.dimension,
      status: check.status,
      summary: check.summary,
    })),
    issues: report.issues.map((issue) => ({
      fingerprint: issue.fingerprint,
      ruleId: issue.ruleId,
      viewport: issue.viewport,
      priority: issue.priority,
      title: issue.title,
      method: issue.method,
    })),
  };
}
export function notRunMatrixRun(engine: BrowserEngine, reason: string): MatrixRun {
  return {
    engine,
    browser: engineLabels[engine],
    version: "not-started",
    directory: "",
    reportPath: "",
    jsonPath: "",
    status: "not-run",
    execution: "not-run",
    summary: null,
    checks: [],
    issues: [],
    error: reason,
  };
}
export function summarizeMatrixRuns(
  browsers: BrowserEngine[],
  runs: MatrixRun[],
  execution: MatrixReport["execution"],
  identity: Pick<
    MatrixReport,
    "toolVersion" | "runId" | "project" | "targetUrl" | "startedAt" | "finishedAt"
  >,
): MatrixReport {
  const comparable = runs.filter((run) => run.execution === "completed" && run.status !== "error");
  const keys = Array.from(
    new Set(comparable.flatMap((run) => run.checks.map((check) => `${check.viewport}\0${check.id}`))),
  ).sort();
  const divergences: MatrixDivergence[] = [];
  for (const key of keys) {
    const [viewport = "", id = ""] = key.split("\0");
    const entries = comparable.map((run) => ({
      engine: run.engine,
      check: run.checks.find((check) => check.viewport === viewport && check.id === id),
    }));
    if (entries.length < 2) continue;
    const statuses = Object.fromEntries(
      browsers.map((engine) => {
        const entry = entries.find((item) => item.engine === engine);
        return [engine, entry?.check?.status ?? "not-run"];
      }),
    ) as Record<BrowserEngine, Status | "not-run">;
    const statusValues = entries.map((entry) => entry.check?.status ?? "not-run");
    if (new Set(statusValues).size === 1) continue;
    const issues = runs.flatMap((run) =>
      run.issues
        .filter((issue) => issue.ruleId === id && issue.viewport === viewport)
        .map((issue) => ({ engine: run.engine, priority: issue.priority })),
    );
    const missing = statusValues.includes("not-run");
    const failure =
      statusValues.some((status) => status === "fail" || status === "error") || issues.length > 0;
    const highestPriority = issues.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])[0]
      ?.priority;
    divergences.push({
      key,
      id,
      viewport,
      ...(entries.find((entry) => entry.check)?.check?.dimension
        ? { dimension: entries.find((entry) => entry.check)?.check?.dimension }
        : {}),
      statuses,
      issueEngines: issues.map((issue) => issue.engine),
      ...(highestPriority ? { highestPriority } : {}),
      classification: missing ? "missing-check" : failure ? "failure-divergence" : "status-divergence",
    });
  }
  const checkStatuses = comparable.flatMap((run) => run.checks);
  const completedRuns = runs.filter((run) => run.execution === "completed");
  const failedRuns = runs.filter(
    (run) => (run.summary?.failed ?? 0) > 0 || run.issues.length > 0 || run.status === "attention",
  );
  const notRun = runs.filter((run) => run.execution === "not-run").length;
  const partial = runs.filter((run) => run.execution !== "completed" && run.execution !== "not-run").length;
  const hasExecutionError = runs.some((run) => run.execution === "error");
  const failingDivergence = divergences.some((item) => item.classification === "failure-divergence");
  const status: MatrixReport["status"] =
    execution.status === "error" || hasExecutionError
      ? "error"
      : execution.status === "partial" || execution.status === "timed-out" || execution.status === "cancelled"
        ? "incomplete"
        : failedRuns.length || failingDivergence
          ? "attention"
          : divergences.length || checkStatuses.some((check) => check.status !== "pass")
            ? "incomplete"
            : "pass";
  return {
    schemaVersion: "1.1",
    ...identity,
    browsers,
    execution,
    status,
    runs,
    summary: {
      enginesRequested: browsers.length,
      enginesCompleted: completedRuns.length,
      enginesPartial: partial,
      enginesNotRun: notRun,
      enginesWithFailures: failedRuns.length,
      checksCompared: keys.length,
      divergentChecks: divergences.length,
      failingDivergences: divergences.filter((item) => item.classification === "failure-divergence").length,
      passAcrossAll: keys.filter((key) => {
        const [viewport = "", id = ""] = key.split("\0");
        return comparable.every((run) =>
          run.checks.some(
            (check) => check.viewport === viewport && check.id === id && check.status === "pass",
          ),
        );
      }).length,
      unknownOnAny: checkStatuses.filter((check) => check.status === "unknown").length,
      missingOnAny: divergences.filter((item) => item.classification === "missing-check").length,
    },
    divergences,
    limitations: [
      "矩阵汇总只比较各引擎的检查状态与问题，不比较截图像素、视觉观感或性能。",
      "没有状态差异不等于视觉一致；审美维度仍需人工或后续视觉模型评审。",
      "单次矩阵只覆盖已配置的视口、场景和真实启动的浏览器引擎，不代表全部设备或浏览器版本。",
      "任一引擎执行失败、超时或取消都会使矩阵证据不完整，不能将其他引擎的通过解释为整体通过。",
    ],
  };
}
export function renderMatrixHtml(report: MatrixReport): string {
  const e = escapeHtml;
  const safeReportPath = (path: string) =>
    /^(?:[a-zA-Z0-9._-]+\/)+report\.html$/.test(path) && !path.split("/").includes("..");
  const statusLabel: Record<string, string> = {
    pass: "通过",
    attention: "发现问题",
    incomplete: "评审未完整",
    error: "执行异常",
    completed: "已完成",
    partial: "部分完成",
    "timed-out": "已超时",
    cancelled: "已取消",
    "not-run": "未执行",
  };
  const runRows = report.runs
    .map((run) => {
      const reportPath = run.reportPath && safeReportPath(run.reportPath) ? run.reportPath : "";
      return (
        `<article class="run"><div class="run-head"><h3>${e(run.browser)}</h3><span class="badge ${e(run.status)}">${e(statusLabel[run.status] ?? run.status)}</span></div>` +
        `<p class="meta">${e(run.engine)} · ${e(run.version)} · ${e(run.execution)}</p>` +
        (reportPath
          ? `<p><a href="${e(reportPath)}">打开 ${e(run.browser)} 独立报告</a></p>`
          : `<p class="notice">${e(run.error ?? "未执行")}</p>`) +
        (run.summary
          ? `<dl><div><dt>通过 / 检查</dt><dd>${run.summary.passed} / ${run.summary.total}</dd></div><div><dt>失败</dt><dd>${run.summary.failed}</dd></div><div><dt>未知</dt><dd>${run.summary.unknown}</dd></div><div><dt>执行错误</dt><dd>${run.summary.errors}</dd></div></dl>`
          : "") +
        "</article>"
      );
    })
    .join("");
  const divergences = report.divergences.length
    ? `<table><thead><tr><th>检查</th><th>视口</th><th>状态差异</th><th>分类</th></tr></thead><tbody>${report.divergences
        .map(
          (item) =>
            `<tr><td><code>${e(item.id)}</code></td><td>${e(item.viewport)}</td><td>${report.browsers
              .map((engine) => `${e(engineLabels[engine])}: ${e(item.statuses[engine])}`)
              .join("<br>")}</td><td>${e(item.classification)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="notice">已完成引擎之间没有检测到状态差异。这不代表截图、视觉质量或设备体验一致。</p>`;
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'; img-src \'self\' data:"><title>AestheticFlow Matrix · ' +
    e(report.project) +
    "</title><style>" +
    css +
    '</style></head><body><header><a class="skip" href="#main">跳到矩阵汇总</a><div class="brand"><span class="mark">A/</span><span>AestheticFlow<br><small>BROWSER MATRIX / EVIDENCE FIRST</small></span></div><span class="edition">MATRIX · v0.5</span></header><main id="main"><section class="hero"><p class="eyebrow">CROSS-ENGINE REVIEW / ' +
    e(report.startedAt.slice(0, 10)) +
    '</p><h1>多个引擎，<br>各自作证。</h1><div class="hero-bottom"><div><h2>' +
    e(report.project) +
    '</h2><p class="meta">' +
    e(report.targetUrl) +
    '</p></div><span class="badge ' +
    e(report.status) +
    '">' +
    e(statusLabel[report.status]) +
    '</span></div></section><section class="metrics">' +
    [
      ["已完成引擎", `${report.summary.enginesCompleted} / ${report.summary.enginesRequested}`],
      ["引擎状态差异", String(report.summary.divergentChecks)],
      ["失败差异", String(report.summary.failingDivergences)],
      ["共同通过检查", String(report.summary.passAcrossAll)],
    ]
      .map(([title, value]) => `<div><p>${e(title)}</p><strong>${e(value)}</strong></div>`)
      .join("") +
    '</section><section><div class="section-title"><h2>01 / 独立引擎</h2><span>' +
    report.runs.length +
    ' engines</span></div><div class="runs">' +
    runRows +
    '</div></section><section><div class="section-title"><h2>02 / 状态差异</h2><span>status only</span></div>' +
    divergences +
    '</section><section><div class="section-title"><h2>03 / 解释边界</h2><span>read carefully</span></div><ul>' +
    report.limitations.map((item) => `<li>${e(item)}</li>`).join("") +
    '</ul><p><a href="matrix.json">下载矩阵 JSON</a></p></section></main><footer>AestheticFlow · tool ' +
    e(report.toolVersion) +
    " · run " +
    e(report.runId) +
    "</footer></body></html>"
  );
}
const css =
  ':root{color-scheme:light;--paper:#f4f2eb;--ink:#17231f;--muted:#5c6963;--line:#cbd1c8;--accent:#dceba8;--alert:#c8653c}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}header,main,footer{max-width:1240px;margin:auto;padding:0 48px}header{padding-top:30px;padding-bottom:24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.brand{display:flex;gap:14px;font-size:20px;font-weight:750;line-height:1.3}.mark{font:700 38px/1.1 Georgia,serif}.brand small,.edition,.eyebrow,.meta{font-size:11px;letter-spacing:.08em;color:var(--muted)}.skip{position:absolute;left:10px;top:-100px}.skip:focus{top:10px;background:white;padding:10px}.hero{padding:54px 0 34px}.eyebrow{font-weight:700}h1{font-size:clamp(40px,6vw,78px);line-height:1.08;letter-spacing:-.055em;margin:20px 0 38px}h2{font-size:24px;margin:0}h3{font-size:20px;margin:0}.hero-bottom{display:flex;justify-content:space-between;align-items:center;gap:20px}.badge{display:inline-block;background:var(--ink);color:var(--accent);padding:7px 13px;font-size:12px;white-space:nowrap}.badge.error,.badge.attention{background:#763b27;color:#fff2df}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--accent);border-top:1px solid var(--ink);border-bottom:1px solid var(--ink)}.metrics>div{padding:22px 20px;border-right:1px solid #aeba83}.metrics>div:last-child{border:0}.metrics p{margin:0 0 9px;font-size:13px}.metrics strong{font-size:clamp(26px,3vw,42px);line-height:1.2}.section-title{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--ink);padding-bottom:18px;margin:50px 0 22px}.section-title span{font-size:11px;color:var(--muted);letter-spacing:.08em}.runs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.run{background:#e8ebe2;border:1px solid var(--line);padding:20px}.run-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.run .meta{margin:8px 0 18px}.run dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0}.run dl div{border-top:1px solid var(--line);padding-top:8px}.run dt{font-size:11px;color:var(--muted)}.run dd{margin:2px 0;font-size:19px}a{color:#245f44;text-underline-offset:4px}.notice{background:#e6e9df;padding:18px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line)}th{font-size:11px;letter-spacing:.06em;color:var(--muted)}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}li{margin-bottom:9px;color:var(--muted)}footer{padding:30px 0 40px;margin-top:50px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}@media(max-width:820px){header,main,footer{padding-left:20px;padding-right:20px}.runs{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.metrics>div:nth-child(2){border-right:0}.hero-bottom{align-items:flex-start;flex-direction:column}.edition{display:none}table{display:block;overflow-x:auto}}';
