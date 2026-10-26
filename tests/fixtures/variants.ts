export const isolatedCases: Record<string, string> = {
  "/cases/infinite-scroll":
    '<div id="grow" style="height:1600px">滚动后继续增长</div><script>window.addEventListener("scroll",()=>{if(scrollY+innerHeight>=document.documentElement.scrollHeight-120){const el=document.getElementById("grow");el.style.height=(el.offsetHeight+1000)+"px";}})</script>',
  "/cases/hung-renderer": "<p>卡住的页面</p><script>while(true){}</script>",
  "/cases/cancel-interaction":
    '<button type="button" id="start" onclick="fetch(&quot;/signals/start&quot;)">开始等待</button><p id="result">未完成</p><button type="button" id="later" onclick="fetch(&quot;/signals/later&quot;)">不应执行</button>',
  "/cases/diagnostic-flood":
    '<p>诊断上限测试</p><script>for(let i=0;i<520;i++)console.error("Flood fixture "+i)</script>',
  "/cases/overflow": '<div style="width:1800px">固定宽度溢出</div>',
  "/cases/broken-image": '<img src="/missing.png" width="160" height="100" alt="故意损坏的图片">',
  "/cases/console-error": '<p>正常内容</p><script>console.error("Isolated console fixture")</script>',
  "/cases/dead-button": '<button type="button" id="save">保存</button><p id="result">未保存</p>',
  "/cases/mobile-layout":
    '<style>@media(max-width:600px){#content{min-width:800px}}</style><div id="content">仅在移动视口溢出</div>',
  "/cases/keyboard-focus":
    '<style>button:focus{outline:none;box-shadow:none}</style><button type="button" id="target">无焦点指示</button>',
};
export function caseDocument(body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Isolated defect fixture</title><style>body{font:16px/1.6 system-ui;margin:0}main{padding:24px}button{font:inherit;padding:12px}</style></head><body><main><h1>独立规则验证</h1>${body}</main></body></html>`;
}
