import type { Report } from "./types.js";
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const names = {
  hierarchy: "层级与排版",
  layout: "布局与空间",
  color: "色彩与一致性",
  interaction: "交互完整性",
  responsive: "响应式质量",
  accessibility: "无障碍与可用性",
};
const labels = {
  pass: "通过",
  fail: "失败",
  unknown: "待确认",
  skipped: "未执行",
  error: "执行错误",
  attention: "发现问题",
  incomplete: "评审未完整",
};
export function renderHtml(r: Report): string {
  const e = escapeHtml;
  const safeImage = (s: string) => (/^screenshots\/[a-zA-Z0-9._-]+\.png$/.test(s) ? s : "");
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src ' +
    "'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" +
    '"><title>AestheticFlow · ' +
    e(r.project) +
    "</title><style>" +
    css +
    '</style></head><body><header><a href="#main" class="skip">跳到报告</a><div class="brand"><span class="mark">A/</span><span>AestheticFlow<br><small>WEB QUALITY / EVIDENCE FIRST</small></span></div><span class="edition">LOCAL REVIEW · v0.5</span></header><main id="main"><section class="intro"><p class="eyebrow">BROWSER REVIEW / ' +
    e(r.startedAt.slice(0, 10)) +
    " / " +
    e(r.browser.name) +
    '</p><h1>让设计判断，<br>有据可依。</h1><div class="intro-bottom"><div><h2>' +
    e(r.project) +
    '</h2><p class="url">' +
    e(r.targetUrl) +
    '</p></div><span class="status">' +
    e(labels[r.status] ?? r.status) +
    "</span></div>" +
    (r.execution
      ? `<p class="notice">运行状态：${e({ completed: "浏览器流程结束", "timed-out": "已达到总时限", cancelled: "用户已取消", error: "执行异常" }[r.execution.status])} · 总时限 ${e(r.execution.timeoutMs)}ms · 实际耗时 ${e(r.execution.elapsedMs)}ms。状态不代表视觉评审已完成。</p>`
      : "") +
    '</section><section aria-label="检查概览" class="metrics">' +
    [
      ["已执行检查", `${r.summary.executed} / ${r.summary.total}`, "仅通过与失败计入已完成"],
      ["高优先级问题", String(r.summary.byPriority.P0 + r.summary.byPriority.P1), "P0 阻断 / P1 严重体验"],
      ["检查覆盖率", `${r.summary.coverage}%`, "不是审美分数或合规率"],
      ["视觉审美评分", "未评估", "未调用视觉模型；需人工评审"],
    ]
      .map(
        ([title, value, note]) =>
          `<div><p>${e(title)}</p><strong>${e(value)}</strong><small>${e(note)}</small></div>`,
      )
      .join("") +
    '</section><nav aria-label="报告章节"><a href="#findings">问题与建议</a><a href="#screens">实际截图</a><a href="#coverage">覆盖范围</a><a href="#checks">执行明细</a><a href="#limits">限制与下一步</a></nav><section id="findings"><div class="section-title"><h2>01 / 问题与建议</h2><span>' +
    r.issues.length +
    " findings</span></div>" +
    (r.issues.length
      ? r.issues
          .map(
            (i) =>
              '<article class="finding"><div class="finding-head"><span class="priority">' +
              e(i.priority) +
              "</span><h3>" +
              e(i.title) +
              '</h3></div><p class="meta">' +
              e(i.viewport) +
              " · " +
              e(i.ruleId) +
              " · " +
              e(i.method) +
              "</p><p>" +
              e(i.suggestion) +
              "</p><details><summary>展开检查证据</summary><pre>" +
              e(JSON.stringify(i.evidence, null, 2)) +
              "</pre></details></article>",
          )
          .join("")
      : '<p class="notice">自动检查未发现问题，不代表整体视觉、全部交互或无障碍合规通过。</p>') +
    '</section><section id="screens"><div class="section-title"><h2>02 / 截图与像素证据</h2><span>' +
    r.screenshots.length +
    ' captures</span></div><div class="gallery">' +
    r.screenshots
      .map(
        (s) =>
          '<figure><a href="' +
          e(safeImage(s.path)) +
          '"><img loading="lazy" src="' +
          e(safeImage(s.path)) +
          '" alt="' +
          e(`${s.viewport} / ${s.phase}`) +
          (s.kind === "diff"
            ? ' 像素差异图"></a><figcaption><strong>'
            : ' 实际页面截图"></a><figcaption><strong>') +
          e(s.kind === "diff" ? `像素差异图 · ${s.viewport}` : s.viewport) +
          " · " +
          s.width +
          " × " +
          s.height +
          "</strong><span>" +
          e(
            s.scenario && s.stepIndex !== undefined
              ? `${s.scenario} / 第 ${s.stepIndex + 1} 步 / ${s.action}`
              : s.phase,
          ) +
          (s.truncated ? " · 超长页面仅截首屏" : "") +
          "</span></figcaption></figure>",
      )
      .join("") +
    '</div></section><section id="coverage"><div class="section-title"><h2>03 / 评审覆盖范围</h2><span>不把未知当通过</span></div><div class="dimensions">' +
    r.dimensions
      .map(
        (d) =>
          "<article><h3>" +
          e(names[d.dimension]) +
          '</h3><p class="dim-count">' +
          d.executed +
          " / " +
          d.total +
          ' <small>检查完成</small></p><meter min="0" max="100" value="' +
          d.coverage +
          '">' +
          d.coverage +
          "%</meter><p>权重 " +
          d.weight +
          " · 评分：未评估<br>需要人工补充视觉与使用体验判断</p></article>",
      )
      .join("") +
    '</div></section><section id="checks"><div class="section-title"><h2>04 / 执行明细</h2><span>' +
    r.summary.unknown +
    " 待确认 · " +
    r.summary.skipped +
    " 未执行</span></div>" +
    r.checks
      .map(
        (c) =>
          '<details class="check"><summary><span class="pill">' +
          e(labels[c.status]) +
          "</span> " +
          e(c.viewport) +
          " / " +
          e(c.id) +
          "<small>" +
          e(c.method) +
          "</small></summary><p>" +
          e(c.summary) +
          "</p><pre>" +
          e(JSON.stringify(c.evidence, null, 2)) +
          "</pre></details>",
      )
      .join("") +
    '</section><section id="limits"><div class="section-title"><h2>05 / 限制与下一步</h2></div><ul>' +
    r.limitations.map((l) => `<li>${e(l)}</li>`).join("") +
    '</ul><div class="next"><h3>下一轮，从最影响使用的问题开始。</h3><p>先处理 P0 / P1 → 保留原测试 → 小范围修复 → 重新审查 → compare 对比。最多 ' +
    r.config.maxIterations +
    " 轮；代码修改仍由获得授权的 Agent 或开发者执行。</p></div><details><summary>运行诊断与元数据</summary><pre>" +
    e(
      JSON.stringify(
        { runId: r.runId, browser: r.browser, finishedAt: r.finishedAt, diagnostics: r.diagnostics },
        null,
        2,
      ),
    ) +
    "</pre></details></section></main><footer>AestheticFlow / 本地生成，不上传截图或源代码。<span>" +
    e(r.runId) +
    "</span></footer></body></html>"
  );
}
const css =
  ':root{color-scheme:light;--paper:#f5f4ef;--ink:#1c2926;--muted:#596862;--line:#cdd3ca;--accent:#d9ed9c}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}a{color:inherit;text-underline-offset:5px}a:focus-visible,summary:focus-visible{outline:3px solid #316b4c;outline-offset:4px}header,main,footer{max-width:1280px;margin:auto;padding:0 48px}header{padding-top:32px;padding-bottom:26px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}.brand{display:flex;gap:14px;font-size:20px;font-weight:750;line-height:1.3}.mark{font:700 38px/1.1 Georgia,serif}.brand small,.edition,.eyebrow,.meta,figcaption span{font-size:11px;letter-spacing:.08em;color:var(--muted)}.skip{position:absolute;left:10px;top:-100px}.skip:focus{top:10px;background:white;padding:10px}.intro{padding:55px 0 32px}.eyebrow{font-weight:700}h1{font-size:clamp(38px,5.2vw,72px);line-height:1.18;letter-spacing:-.045em;margin:22px 0 40px;font-weight:650}h2{font-size:23px;margin:0}h3{font-size:17px;margin:0}.intro-bottom{display:flex;justify-content:space-between;gap:20px;align-items:center}.url{font-family:ui-monospace,monospace;font-size:13px;overflow-wrap:anywhere;color:var(--muted)}.status{background:var(--ink);color:var(--accent);padding:9px 18px;white-space:nowrap;font-size:14px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--accent);border-top:1px solid var(--ink);border-bottom:1px solid var(--ink)}.metrics>div{padding:22px 20px;border-right:1px solid #abbc86}.metrics>div:last-child{border:0}.metrics p{font-size:13px;margin:0 0 10px}.metrics strong{display:block;font-size:clamp(24px,3vw,40px);letter-spacing:-.04em;line-height:1.3}.metrics small{display:block;font-size:11px;margin-top:10px}nav{display:flex;gap:28px;padding:20px 0;border-bottom:1px solid var(--line);flex-wrap:wrap;font-size:13px}section[id]{padding-top:48px;scroll-margin-top:20px}.section-title{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding-bottom:20px;border-bottom:1px solid var(--ink);margin-bottom:22px}.section-title h2{font-size:22px}.section-title span{font-size:12px;color:var(--muted)}.finding{padding:22px 0;border-bottom:1px solid var(--line)}.finding-head{display:flex;align-items:baseline;gap:16px}.priority{font-family:ui-monospace,monospace;font-size:12px;padding:2px 8px;border:1px solid #a95732;color:#79412c}.finding p{max-width:85ch}.meta{margin:10px 0}.finding details{margin-top:16px}summary{cursor:pointer;font-size:13px;padding:7px 0}pre{background:#eaece5;padding:18px;overflow-wrap:anywhere;white-space:pre-wrap;font:12px/1.6 ui-monospace,monospace;max-height:460px;overflow:auto;border:1px solid var(--line)}.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:start}figure{margin:0;background:#e9ece4;padding:12px;border:1px solid var(--line)}figure a{display:block;height:300px;overflow:hidden;background:white}figure img{width:100%;height:auto;display:block;object-fit:contain;object-position:top}figcaption{padding:14px 4px 0}figcaption strong,figcaption span{display:block}figcaption strong{font-size:12px}.dimensions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.dimensions article{padding:20px 0;border-bottom:1px solid var(--line)}.dim-count{font-size:28px;line-height:1.3;margin:16px 0}.dim-count small{font-size:11px;color:var(--muted)}meter{width:100%;height:7px;display:block}.dimensions article>p:last-child{font-size:12px;color:var(--muted);line-height:1.8}.check{border-bottom:1px solid var(--line);padding:8px 0}.check summary{overflow-wrap:anywhere}.check small{float:right;color:var(--muted);padding:0 5px}.pill{display:inline-block;min-width:65px;color:var(--ink);font-size:11px;margin-right:10px}.notice,.next{background:#e7ebdf;padding:24px}.next{margin:26px 0}.next p{max-width:80ch;margin-bottom:0}li{margin-bottom:8px;font-size:14px;color:var(--muted)}footer{margin-top:64px;padding-top:24px;padding-bottom:32px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}footer span{display:block;overflow-wrap:anywhere}@media(max-width:760px){header,main,footer{padding-left:20px;padding-right:20px}.edition{display:none}.intro{padding-top:32px}.intro-bottom{align-items:start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics>div{border-bottom:1px solid #abbc86}.metrics>div:nth-child(2){border-right:0}.metrics>div:nth-child(3){border-bottom:0}.gallery,.dimensions{grid-template-columns:1fr}.section-title{display:block}.section-title span{display:block;margin-top:6px}nav{gap:14px}.check small{float:none;display:block;margin-left:75px}.gallery figure a{height:400px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:white}nav,.skip{display:none}header,main,footer{padding:15px}details{break-inside:avoid}.gallery{grid-template-columns:repeat(3,1fr)}.finding{break-inside:avoid}}';
