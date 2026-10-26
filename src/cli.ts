#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type BrowserEngine, browserEngines, loadConfig, parseBrowsers, parseViewports } from "./config.js";
import { reviewMatrix } from "./matrix.js";
import { checkSkill, inspectProject } from "./project.js";
import { compareReports } from "./reports/compare.js";
import { priorityAtLeast } from "./reports/types.js";
import { review } from "./reviewer.js";
import { message } from "./utils/safety.js";
import { VERSION } from "./version.js";

const help =
  "AestheticFlow / web-aesthetic 0.5.0\n\nCommands:\n  skill-check [package-directory]\n  inspect-project [directory]\n  review --url http://127.0.0.1:3000 [--config file.json]\n         [--browser chromium|firefox|webkit] [--viewports 1440x900,768x1024,390x844] [--output artifacts]\n         [--pixel-baseline | --update-pixel-baseline] [--pixel-baseline-dir artifacts/pixel-baselines]\n         [--allow-origin https://example.com] [--allow-private-network]\n         [--timeout-ms 10000] [--review-timeout-ms 120000] [--wait-ms 300] [--fail-on P0|P1|P2|P3|none]\n  matrix --url http://127.0.0.1:3000 [--config file.json]\n         [--browsers chromium,firefox,webkit] [--matrix-timeout-ms 360000] [--output artifacts]\n         [--pixel-baseline | --update-pixel-baseline]\n  compare --before report.json --after report.json [--iteration 1] [--output diff.json]\n\n默认仅允许目标本机 origin；其他 origin 必须显式允许。matrix 默认真实运行三个引擎，每份引擎报告独立保存。像素基线只做同浏览器/视口比较，不产生审美分数。\n退出码：0=未触发失败阈值（不代表完整通过），1=问题达到阈值，2=配置/执行错误或不完整矩阵。\n";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.log(help);
    return;
  }
  if (command === "--version") {
    console.log(VERSION);
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      browser: { type: "string" },
      browsers: { type: "string" },
      config: { type: "string" },
      viewports: { type: "string" },
      output: { type: "string" },
      project: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      "allow-private-network": { type: "boolean" },
      "fail-on": { type: "string" },
      "timeout-ms": { type: "string" },
      "review-timeout-ms": { type: "string" },
      "matrix-timeout-ms": { type: "string" },
      "pixel-baseline": { type: "boolean" },
      "update-pixel-baseline": { type: "boolean" },
      "pixel-baseline-dir": { type: "string" },
      "wait-ms": { type: "string" },
      before: { type: "string" },
      after: { type: "string" },
      iteration: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (command === "skill-check") {
    const result = await checkSkill(positionals[0] ? resolve(positionals[0]) : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "inspect-project") {
    console.log(JSON.stringify(await inspectProject(positionals[0] ?? process.cwd()), null, 2));
    return;
  }
  if (command === "compare") {
    if (!values.before || !values.after) throw new Error("compare 需要 --before 和 --after JSON 报告");
    const result = compareReports(
      JSON.parse(await readFile(values.before, "utf8")),
      JSON.parse(await readFile(values.after, "utf8")),
      Number(values.iteration ?? 1),
    );
    const text = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) await writeFile(resolve(values.output), text, { encoding: "utf8", flag: "wx" });
    console.log(text);
    return;
  }
  if (command !== "review" && command !== "matrix") throw new Error(`未知命令：${command}`);
  if (positionals.length) throw new Error(`${command} 不接受额外位置参数`);
  const config = await loadConfig(values.config, {
    url: values.url,
    browser: values.browser,
    viewports: values.viewports ? parseViewports(values.viewports) : undefined,
    output: values.output,
    project: values.project,
    allowOrigins: values["allow-origin"],
    allowPrivateNetwork: values["allow-private-network"],
    failOn: values["fail-on"],
    reviewTimeoutMs: values["review-timeout-ms"] ? Number(values["review-timeout-ms"]) : undefined,
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
    waitMs: values["wait-ms"] ? Number(values["wait-ms"]) : undefined,
  });
  if (values["pixel-baseline"] && values["update-pixel-baseline"])
    throw new Error("--pixel-baseline 与 --update-pixel-baseline 不能同时使用");
  if (values["pixel-baseline"] || values["update-pixel-baseline"] || values["pixel-baseline-dir"])
    config.pixelBaseline = {
      ...config.pixelBaseline,
      enabled: true,
      ...(values["update-pixel-baseline"]
        ? { mode: "update" as const }
        : values["pixel-baseline"]
          ? { mode: "compare" as const }
          : {}),
      ...(values["pixel-baseline-dir"] ? { directory: values["pixel-baseline-dir"] } : {}),
    };
  let matrixBrowsers: BrowserEngine[] | undefined;
  if (command === "matrix") {
    if (values.browser) throw new Error("matrix 使用 --browsers，而不是 --browser");
    matrixBrowsers = values.browsers ? parseBrowsers(values.browsers) : [...browserEngines];
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  if (command === "matrix") {
    let result: Awaited<ReturnType<typeof reviewMatrix>>;
    try {
      result = await reviewMatrix(config, matrixBrowsers ?? [], {
        signal: controller.signal,
        timeoutMs: values["matrix-timeout-ms"] ? Number(values["matrix-timeout-ms"]) : undefined,
      });
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    const { report, directory } = result;
    console.log(
      JSON.stringify(
        {
          status: report.status,
          execution: report.execution,
          engines: report.runs.map((run) => ({
            engine: run.engine,
            browser: run.browser,
            version: run.version,
            status: run.status,
            execution: run.execution,
            report: run.reportPath ? resolve(directory, run.reportPath) : null,
          })),
          report: resolve(directory, "report.html"),
          json: resolve(directory, "matrix.json"),
          summary: report.summary,
        },
        null,
        2,
      ),
    );
    if (report.execution.status !== "completed" || report.status === "error") process.exitCode = 2;
    else if (
      report.runs.some((run) => run.issues.some((issue) => priorityAtLeast(issue.priority, config.failOn)))
    )
      process.exitCode = 1;
    return;
  }
  let result: Awaited<ReturnType<typeof review>>;
  try {
    result = await review(config, { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  const { report, directory } = result;
  console.log(
    JSON.stringify(
      {
        status: report.status,
        browser: report.browser,
        execution: report.execution,
        report: resolve(directory, "report.html"),
        json: resolve(directory, "report.json"),
        screenshots: report.screenshots.length,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
  if (report.status === "error" || report.summary.errors) process.exitCode = 2;
  else if (report.issues.some((i) => priorityAtLeast(i.priority, config.failOn))) process.exitCode = 1;
}
main().catch((error) => {
  console.error(`AestheticFlow: ${message(error)}`);
  process.exitCode = 2;
});
