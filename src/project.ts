import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function inspectProject(directory: string) {
  const root = resolve(directory);
  const hasPackage = await exists(join(root, "package.json"));
  const p = hasPackage ? JSON.parse(await readFile(join(root, "package.json"), "utf8")) : {};
  const dependencies = { ...p.dependencies, ...p.devDependencies };
  const frameworks = ["next", "vite", "react", "vue", "astro", "svelte", "@angular/core"].filter(
    (d) => d in dependencies,
  );
  const scripts = typeof p.scripts === "object" && p.scripts ? p.scripts : {};
  const tests = (await readdir(root)).filter((n) =>
    /^(tests?|__tests__|playwright\.config\.|vitest\.config\.)/.test(n),
  );
  return {
    directory: root,
    hasPackage,
    frameworks,
    scripts,
    testEntries: tests,
    recommendations: [
      !hasPackage
        ? "未发现 package.json；可以审查已有静态服务器 URL。"
        : scripts.dev
          ? "存在 dev 脚本；先人工检查脚本再启动。"
          : "没有 dev 脚本，请按该项目说明启动服务器。",
      "不会自动执行项目脚本。确认实际开发服务端口，再运行 web-aesthetic review --url <URL>。",
      "为核心用户任务配置显式断言；菜单、弹窗、表单和键盘分别建场景。",
    ],
  };
}
const required = [
  "SKILL.md",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "references/design-principles.md",
  "references/interaction-design.md",
  "references/visual-review.md",
  "workflows/browser-review.md",
  "workflows/iterative-refinement.md",
  "checklists/release-quality.md",
  "styles/minimal.md",
  "styles/editorial.md",
  "styles/swiss.md",
  "styles/brutalist.md",
  "styles/futuristic.md",
  "styles/organic.md",
  "styles/retro.md",
  "styles/data-driven.md",
  "templates/review-config.example.json",
  "docs/installation.md",
  "docs/usage.md",
  "docs/architecture.md",
  "scripts/install-skill.mjs",
];
export async function checkSkill(directory = packageRoot) {
  const errors: string[] = [];
  for (const file of required) {
    try {
      const text = await readFile(join(directory, file), "utf8");
      if (text.trim().length < 40) errors.push(`${file} 内容过少或为空`);
    } catch {
      errors.push(`缺少 ${file}`);
    }
  }
  let entry = "";
  try {
    entry = await readFile(join(directory, "SKILL.md"), "utf8");
  } catch {}
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)?.[1] ?? "";
  if (!/^name: web-aesthetic\s*$/m.test(front)) errors.push("SKILL.md 缺少规范 name");
  if (!/^description: .{20,}$/m.test(front)) errors.push("SKILL.md 缺少有效 description");
  const resources = [
    "SKILL.md",
    ...(
      await Promise.all(
        ["references", "styles", "workflows", "checklists", "examples", "docs"].map(async (dir) => {
          try {
            return (await readdir(join(directory, dir)))
              .filter((n) => n.endsWith(".md"))
              .map((n) => `${dir}/${n}`);
          } catch {
            return [];
          }
        }),
      )
    ).flat(),
  ];
  for (const file of resources) {
    const text = await readFile(join(directory, file), "utf8");
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const ref = m[1]?.split("#")[0];
      if (ref && !/^(https?:|mailto:)/.test(ref) && !(await exists(resolve(directory, dirname(file), ref))))
        errors.push(`${file} 断链: ${ref}`);
    }
  }
  return { ok: errors.length === 0, root: directory, checked: resources.length, errors };
}
