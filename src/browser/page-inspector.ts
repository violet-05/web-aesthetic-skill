import type { Page } from "playwright";
export async function inspectPage(page: Page) {
  return page.evaluate(() => {
    const helpers = {
      visible(el: Element) {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      },
      selector(el: Element) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const test = el.getAttribute("data-testid");
        if (test) return `[data-testid="${CSS.escape(test)}"]`;
        const parts: string[] = [];
        let current: Element | null = el;
        for (let i = 0; current && i < 4; i++) {
          const parent: Element | null = current.parentElement;
          parts.unshift(
            current.tagName.toLowerCase() +
              (parent ? `:nth-child(${Array.from(parent.children).indexOf(current) + 1})` : ""),
          );
          current = parent;
        }
        return parts.join(" > ");
      },
    };
    const sample = Array.from(document.body?.querySelectorAll("*") ?? []).slice(0, 2500);
    const width = document.documentElement.clientWidth;
    const overflow = sample
      .filter(helpers.visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > width + 2 || r.left < -2)
      .slice(0, 20)
      .map(({ el, r }) => ({
        selector: helpers.selector(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        tag: el.tagName.toLowerCase(),
      }));
    const images = Array.from(document.images)
      .slice(0, 200)
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          selector: helpers.selector(img),
          src: img.currentSrc || img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: Math.round(r.width),
          height: Math.round(r.height),
          visible: helpers.visible(img),
          loading: img.loading,
          alt: img.getAttribute("alt"),
          top: r.top,
        };
      });
    const clipped = sample
      .filter((el) => el.matches("h1,h2,nav,button") && helpers.visible(el))
      .filter((el) => {
        const e = el as HTMLElement;
        const s = getComputedStyle(el);
        return (
          (e.scrollWidth > e.clientWidth + 2 && ["hidden", "clip"].includes(s.overflowX)) ||
          (e.scrollHeight > e.clientHeight + 2 && ["hidden", "clip"].includes(s.overflowY))
        );
      })
      .map((el) => ({ selector: helpers.selector(el), text: (el.textContent ?? "").trim().slice(0, 100) }))
      .slice(0, 15);
    const controls = sample
      .filter(
        (el) =>
          el.matches("button,a[href],input:not([type=hidden]),select,textarea,[role=button]") &&
          helpers.visible(el),
      )
      .slice(0, 200)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const labels =
          "labels" in el
            ? Array.from((el as HTMLInputElement).labels ?? [])
                .map((l) => l.textContent ?? "")
                .join("")
            : "";
        const ids = (el.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        const childAlt = Array.from(el.querySelectorAll("img[alt]"))
          .map((i) => i.getAttribute("alt") ?? "")
          .join(" ");
        const name = (
          el.getAttribute("aria-label") ||
          ids ||
          labels ||
          el.textContent ||
          childAlt ||
          el.getAttribute("title") ||
          el.getAttribute("value") ||
          ""
        ).trim();
        const x = rect.left + rect.width / 2,
          y = rect.top + rect.height / 2;
        const hit =
          x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
        return {
          selector: helpers.selector(el),
          name: name.slice(0, 100),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          obscured: !!hit && hit !== el && !el.contains(hit),
          tag: el.tagName.toLowerCase(),
        };
      });
    // biome-ignore lint/performance/useDomNodeTextContent: Rendered text is required; hidden/script text must not make an empty page pass.
    const text = (document.body?.innerText ?? "").trim();
    return {
      title: document.title,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
      viewportWidth: width,
      documentHeight: document.documentElement.scrollHeight,
      bodyTextLength: text.length,
      hasVisualMedia: sample.some((el) => el.matches("img,svg,canvas,video,iframe") && helpers.visible(el)),
      hasPaintedContent: sample.some((el) => {
        if (!helpers.visible(el)) return false;
        const s = getComputedStyle(el);
        const before = getComputedStyle(el, "::before").content;
        return (
          s.backgroundImage !== "none" ||
          !["transparent", "rgba(0, 0, 0, 0)"].includes(s.backgroundColor) ||
          !["none", "normal", '""'].includes(before)
        );
      }),
      elementCount: document.body?.querySelectorAll("*").length ?? 0,
      overflow,
      images,
      clipped,
      controls,
      mainCount: document.querySelectorAll("main,[role=main]").length,
      h1Count: document.querySelectorAll("h1").length,
      lang: document.documentElement.lang,
    };
  });
}
export type PageSnapshot = Awaited<ReturnType<typeof inspectPage>>;
