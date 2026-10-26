#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, parseViewports } from "./config.js";
import { checkSkill, inspectProject } from "./project.js";
import { compareReports } from "./reports/compare.js";
import { priorityAtLeast } from "./reports/types.js";
import { review } from "./reviewer.js";
import { message } from "./utils/safety.js";
import { VERSION } from "./version.js";

const help =
  "AestheticFlow / web-aesthetic 0.2.0\n\nCommands:\n  skill-check [package-directory]\n  inspect-project [directory]\n  review --url http://127.0.0.1:3000 [--config file.json]\n         [--viewports 1440x900,768x1024,390x844] [--output artifacts]\n         [--allow-origin https://example.com] [--allow-private-network]\n         [--timeout-ms 10000] [--review-timeout-ms 120000] [--wait-ms 300] [--fail-on P0|P1|P2|P3|none]\n  compare --before report.json --after report.json [--iteration 1] [--output diff.json]\n\n默认仅允许目标本机 origin；其他 origin 必须显式允许。\n退出码：0=未触发失败阈值（不代表完整通过），1=问题达到阈值，2=配置/执行错误。\n";
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
      config: { type: "string" },
      viewports: { type: "string" },
      output: { type: "string" },
      project: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      "allow-private-network": { type: "boolean" },
      "fail-on": { type: "string" },
      "timeout-ms": { type: "string" },
      "review-timeout-ms": { type: "string" },
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
  if (command !== "review") throw new Error(`未知命令：${command}`);
  if (positionals.length) throw new Error("review 不接受额外位置参数");
  const config = await loadConfig(values.config, {
    url: values.url,
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
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
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
