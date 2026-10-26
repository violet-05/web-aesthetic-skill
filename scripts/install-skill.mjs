#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    target: { type: "string" },
    project: { type: "string" },
    destination: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "node scripts/install-skill.mjs --target codex|cursor [--project path] [--destination exact-path]\nExplicit destination can be used for manual/custom tool installation. Existing directories are never overwritten.",
  );
  process.exit(0);
}
const target = values.target ?? "codex";
const roots = { codex: ".agents/skills", cursor: ".cursor/skills" };
if (!Object.hasOwn(roots, target) && !values.destination)
  throw new Error("支持 codex/cursor；其他工具请在确认官方路径后使用 --destination");
const base = values.project ? resolve(values.project) : homedir();
const destination = values.destination
  ? resolve(values.destination)
  : resolve(base, roots[target], "web-aesthetic");
if (destination === source) throw new Error("不能覆盖项目本身");
const relation = relative(source, destination);
if (relation !== "" && !relation.startsWith("..") && !isAbsolute(relation))
  throw new Error("请将 Skill 安装到本工具仓库之外，避免复制自引用");
try {
  await stat(destination);
  throw new Error(`目标已存在；为保护旧 Skill，拒绝覆盖：${destination}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination);
for (const name of [
  "SKILL.md",
  "agents",
  "references",
  "styles",
  "workflows",
  "checklists",
  "templates",
  "docs",
  "examples",
  "SECURITY.md",
  "LICENSE",
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "scripts/install-skill.mjs",
])
  await cp(resolve(source, name), resolve(destination, name), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
await writeFile(
  resolve(destination, "INSTALLATION.txt"),
  "Installed from " +
    source +
    "\nCLI is installed separately. Run npm ci && npm run build in the source project, then npm link, or install its npm pack archive.\n",
  "utf8",
);
const skill = await readFile(resolve(destination, "SKILL.md"), "utf8");
if (!skill.startsWith("---")) throw new Error("Skill 格式无效");
console.log(
  JSON.stringify(
    {
      target,
      destination,
      files: (await readdir(destination)).length,
      cli: "CLI 单独安装；此脚本只复制 Skill 和知识库，不修改宿主设置。",
    },
    null,
    2,
  ),
);
