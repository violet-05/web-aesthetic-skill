import { readFile } from "node:fs/promises";
import { z } from "zod";

export const dimensions = [
  "hierarchy",
  "layout",
  "color",
  "interaction",
  "responsive",
  "accessibility",
] as const;
export const viewportSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]{1,40}$/),
    width: z.number().int().min(240).max(3840),
    height: z.number().int().min(240).max(2160),
    touch: z.boolean().default(false),
  })
  .strict();
export const browserEngines = ["chromium", "firefox", "webkit"] as const;
export const browserEngineSchema = z.enum(browserEngines);
export const browserListSchema = z
  .array(browserEngineSchema)
  .min(1)
  .max(browserEngines.length)
  .refine((value) => new Set(value).size === value.length, "Browser engines must be unique");
export const locatorSchema = z.union([
  z
    .object({
      role: z.enum([
        "button",
        "link",
        "textbox",
        "checkbox",
        "dialog",
        "tab",
        "menuitem",
        "navigation",
        "heading",
        "combobox",
        "option",
        "switch",
      ]),
      name: z.string().min(1).max(300),
    })
    .strict(),
  z.object({ label: z.string().min(1).max(300) }).strict(),
  z.object({ testId: z.string().min(1).max(200) }).strict(),
  z.object({ css: z.string().min(1).max(500) }).strict(),
]);
const targeted = { target: locatorSchema };
export const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), ...targeted }).strict(),
  z.object({ action: z.literal("tap"), ...targeted }).strict(),
  z.object({ action: z.literal("fill"), ...targeted, value: z.string().max(5000) }).strict(),
  z.object({ action: z.literal("press"), ...targeted, key: z.string().min(1).max(40) }).strict(),
  z.object({ action: z.literal("expectVisible"), ...targeted }).strict(),
  z.object({ action: z.literal("expectHidden"), ...targeted }).strict(),
  z.object({ action: z.literal("expectEnabled"), ...targeted }).strict(),
  z.object({ action: z.literal("expectText"), ...targeted, text: z.string().max(1000) }).strict(),
  z.object({ action: z.literal("expectValue"), ...targeted, value: z.string().max(5000) }).strict(),
  z.object({ action: z.literal("expectUrl"), url: z.string().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("expectFocused"), ...targeted }).strict(),
  z.object({ action: z.literal("checkFocusIndicator"), ...targeted }).strict(),
]);
export const scenarioSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]{1,60}$/),
    description: z.string().max(500).optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).default("P1"),
    steps: z.array(stepSchema).min(1).max(50),
  })
  .strict();
export const defaultViewports = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "tablet", width: 768, height: 1024, touch: false },
  { name: "mobile", width: 390, height: 844, touch: false },
];
const weightSchema = z
  .object({
    hierarchy: z.number().nonnegative(),
    layout: z.number().nonnegative(),
    color: z.number().nonnegative(),
    interaction: z.number().nonnegative(),
    responsive: z.number().nonnegative(),
    accessibility: z.number().nonnegative(),
  })
  .strict()
  .refine((v) => Object.values(v).reduce((a, b) => a + b, 0) > 0, "Weights must have a positive total");
export const lazyLoadSchema = z
  .object({
    enabled: z.boolean().default(false),
    maxScrolls: z.number().int().min(1).max(40).default(12),
    waitMs: z.number().int().min(25).max(2000).default(150),
    maxDurationMs: z.number().int().min(100).max(30000).default(5000),
    scrollContainers: z
      .object({
        enabled: z.boolean().default(false),
        maxContainers: z.number().int().min(1).max(20).default(8),
      })
      .strict()
      .default({ enabled: false, maxContainers: 8 }),
  })
  .strict();
export const stepScreenshotSchema = z
  .object({
    mode: z.enum(["none", "all", "assertions"]).default("none"),
    maxPerViewport: z.number().int().min(1).max(80).default(20),
  })
  .strict();
export const pixelMaskSchema = z
  .object({
    selector: z.string().min(1).max(500),
    reason: z.string().max(200).optional(),
  })
  .strict();
export const pixelBaselineSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["compare", "update"]).default("compare"),
    directory: z.string().min(1).max(1000).default("artifacts/pixel-baselines"),
    maxDiffPixelRatio: z.number().min(0).max(1).default(0.005),
    threshold: z.number().min(0).max(1).default(0.1),
    includeAA: z.boolean().default(false),
    maxPixels: z.number().int().min(1000).max(50000000).default(20000000),
    masks: z
      .array(pixelMaskSchema)
      .max(20)
      .default([])
      .refine(
        (value) => new Set(value.map((mask) => mask.selector)).size === value.length,
        "Mask selectors must be unique",
      ),
  })
  .strict()
  .default({
    enabled: false,
    mode: "compare",
    directory: "artifacts/pixel-baselines",
    maxDiffPixelRatio: 0.005,
    threshold: 0.1,
    includeAA: false,
    maxPixels: 20000000,
    masks: [],
  });
export const configSchema = z
  .object({
    url: z.string().min(1),
    browser: browserEngineSchema.default("chromium"),
    project: z.string().max(150).default("Web review"),
    output: z.string().min(1).default("artifacts"),
    viewports: z
      .array(viewportSchema)
      .min(1)
      .max(8)
      .default(defaultViewports)
      .refine((v) => new Set(v.map((x) => x.name)).size === v.length, "Viewport names must be unique"),
    reviewTimeoutMs: z.number().int().min(1000).max(600000).default(120000),
    lazyLoad: lazyLoadSchema.default({
      enabled: false,
      maxScrolls: 12,
      waitMs: 150,
      maxDurationMs: 5000,
      scrollContainers: { enabled: false, maxContainers: 8 },
    }),
    stepScreenshots: stepScreenshotSchema.default({ mode: "none", maxPerViewport: 20 }),
    pixelBaseline: pixelBaselineSchema,
    timeoutMs: z.number().int().min(500).max(60000).default(10000),
    waitMs: z.number().int().min(0).max(10000).default(300),
    waitFor: locatorSchema.optional(),
    fullPage: z.boolean().default(true),
    maxScreenshotHeight: z.number().int().min(900).max(20000).default(12000),
    requiredElements: z.array(locatorSchema).max(30).default([]),
    interactions: z
      .array(scenarioSchema)
      .max(20)
      .default([])
      .refine((v) => new Set(v.map((x) => x.name)).size === v.length, "Scenario names must be unique"),
    allowOrigins: z.array(z.string()).max(30).default([]),
    allowPrivateNetwork: z.boolean().default(false),
    weights: weightSchema.default({
      hierarchy: 20,
      layout: 20,
      color: 15,
      interaction: 20,
      responsive: 15,
      accessibility: 10,
    }),
    maxIterations: z.number().int().min(1).max(10).default(3),
    failOn: z.enum(["P0", "P1", "P2", "P3", "none"]).default("P1"),
    designGoals: z.array(z.string().max(500)).max(20).default([]),
  })
  .strict();
export type ReviewConfig = z.infer<typeof configSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type BrowserEngine = z.infer<typeof browserEngineSchema>;
export type Target = z.infer<typeof locatorSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export function parseViewports(value: string): Viewport[] {
  return z
    .array(viewportSchema)
    .min(1)
    .max(8)
    .parse(
      value.split(",").map((s, i) => {
        const match = /^(\d{3,4})x(\d{3,4})$/.exec(s.trim());
        if (!match) throw new Error("视口格式应为 1440x900,768x1024,390x844");
        return { name: `viewport-${i + 1}`, width: Number(match[1]), height: Number(match[2]) };
      }),
    );
}
export function parseBrowsers(value: string): BrowserEngine[] {
  return browserListSchema.parse(value.split(",").map((item) => item.trim()));
}
export async function loadConfig(
  file?: string,
  overrides: Record<string, unknown> = {},
): Promise<ReviewConfig> {
  const raw: unknown = file ? JSON.parse(await readFile(file, "utf8")) : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("配置必须是 JSON 对象");
  return configSchema.parse({
    ...raw,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  });
}
