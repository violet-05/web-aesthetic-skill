export type { BrowserEngine, ReviewConfig, Scenario, Step, Target, Viewport } from "./config.js";
export {
  browserEngines,
  browserListSchema,
  configSchema,
  defaultViewports,
  loadConfig,
  parseBrowsers,
  parseViewports,
} from "./config.js";
export type { MatrixOptions } from "./matrix.js";
export { reviewMatrix } from "./matrix.js";
export type { PixelBaselineEvaluation, PixelComparison } from "./pixel/baseline.js";
export { baselineKey, comparePngBuffers, evaluatePixelBaseline } from "./pixel/baseline.js";
export { checkSkill, inspectProject } from "./project.js";
export { compareReports } from "./reports/compare.js";
export type { MatrixReport, MatrixRun } from "./reports/matrix.js";
export type { Check, Issue, Report, VisualReviewer } from "./reports/types.js";
export type { ReviewOptions } from "./reviewer.js";
export { review } from "./reviewer.js";
export { VERSION } from "./version.js";
