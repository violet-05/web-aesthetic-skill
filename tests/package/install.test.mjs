import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("npm pack artifact installs independently, CLI reviews a real page and skill copies do not overwrite", {
  timeout: 180000,
}, async () => {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run this test with npm run test:package");
  const temporary = await mkdtemp(join(tmpdir(), "aesthetic-package-"));
  const runNpm = (args, cwd = process.cwd()) =>
    execFileSync(process.execPath, [npm, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 120000,
      windowsHide: true,
    });
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", temporary]));
  const archive = join(temporary, packed[0].filename);
  const install = join(temporary, "installed");
  runNpm(["install", "--prefix", install, "--ignore-scripts", "--no-audit", "--no-fund", archive]);
  const pkg = join(install, "node_modules", "web-aesthetic-skill"),
    cli = join(pkg, "dist", "cli.js");
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: temporary,
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
  assert.equal(run(["--version"]).trim(), "0.2.0");
  assert.ok(run(["--help"]).includes("compare"));
  assert.equal(JSON.parse(run(["skill-check"])).ok, true);
  assert.equal(JSON.parse(run(["inspect-project", process.cwd()])).hasPackage, true);
  const installer = join(pkg, "scripts", "install-skill.mjs");
  const host = join(temporary, "host-project");
  for (const target of ["codex", "cursor"]) {
    const result = JSON.parse(
      execFileSync(process.execPath, [installer, "--target", target, "--project", host], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
    await access(join(result.destination, "SKILL.md"));
    await access(join(result.destination, "CONTRIBUTING.md"));
    assert.equal(JSON.parse(run(["skill-check", result.destination])).ok, true);
    assert.throws(() =>
      execFileSync(process.execPath, [installer, "--target", target, "--project", host], {
        stdio: "pipe",
        windowsHide: true,
      }),
    );
  }
  const html = await readFile("tests/fixtures/good.html", "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/ok.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="green"/></svg>',
      );
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const result = await new Promise((resolvePromise, reject) => {
      // Keep the in-process fixture server responsive while the installed CLI runs.
      execFile(
        process.execPath,
        [
          cli,
          "review",
          "--url",
          `http://127.0.0.1:${port}`,
          "--viewports",
          "390x844",
          "--output",
          join(temporary, "reports"),
        ],
        { encoding: "utf8", timeout: 30000, windowsHide: true },
        (error, stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolvePromise(JSON.parse(stdout)),
      );
    });
    assert.equal(result.screenshots, 1);
    assert.equal(result.summary.failed, 0);
    const report = JSON.parse(await readFile(result.json, "utf8"));
    assert.equal(report.schemaVersion, "1.1");
    assert.equal(report.summary.aestheticScore, null);
    console.log("Installed-package review:", resolve(result.report));
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
