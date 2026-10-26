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
  "/cases/nested-scroll":
    '<style>#scroll-list{height:180px;overflow-y:auto;border:1px solid #315044}#scroll-spacer{height:900px}img{display:block;width:160px;height:100px;background:#e1ead1}</style><div id="scroll-list" aria-label="懒加载列表"><div id="scroll-spacer">嵌套列表顶部内容</div><img id="nested-lazy" data-src="/ok.svg" alt="嵌套滚动后出现的图片" width="160" height="100"></div><p id="nested-status" role="status">尚未加载</p><script>const list=document.getElementById("scroll-list"),image=document.getElementById("nested-lazy");image.onload=()=>document.getElementById("nested-status").textContent="加载完成";const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){image.src=image.dataset.src;observer.disconnect();}},{root:list});observer.observe(image);</script>',
  "/cases/nested-infinite":
    '<style>#virtual-list{height:220px;overflow-y:auto;border:1px solid #315044}#virtual-content{height:1200px}</style><div id="virtual-list" aria-label="无限虚拟列表"><div id="virtual-content">虚拟列表内容</div></div><script>const list=document.getElementById("virtual-list"),content=document.getElementById("virtual-content");list.addEventListener("scroll",()=>{if(list.scrollTop+list.clientHeight>=list.scrollHeight-100)content.style.height=(content.offsetHeight+800)+"px";})</script>',
  "/cases/touch-target":
    '<button type="button" id="touch-target">触摸目标</button><p id="touch-status" role="status">尚未触摸</p><script>document.getElementById("touch-target").addEventListener("pointerdown",event=>{document.getElementById("touch-status").textContent="pointer:"+(event.pointerType||"unknown")});</script>',
  "/cases/pixel-dynamic":
    '<style>main{max-width:720px}#static-card{height:260px;padding:24px;background:#eef1e7;border:1px solid #315044}#dynamic-box{height:120px;margin-top:20px;border:1px solid #315044;background:#0f6}</style><section id="static-card"><h2>稳定布局</h2><p>这个区域用于验证像素基线；下方动态区域应通过遮罩排除。</p></section><div id="dynamic-box" aria-label="随机变化的动态区域"></div><script>const box=document.getElementById("dynamic-box");const tick=()=>{box.style.background="rgb("+Math.floor(Math.random()*256)+","+Math.floor(Math.random()*256)+","+Math.floor(Math.random()*256)+")"};tick();setInterval(tick,35);</script>',
};
export function caseDocument(body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Isolated defect fixture</title><style>body{font:16px/1.6 system-ui;margin:0}main{padding:24px}button{font:inherit;padding:12px}</style></head><body><main><h1>独立规则验证</h1>${body}</main></body></html>`;
}
