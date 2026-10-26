import type { ReviewConfig, Viewport } from "../config.js";
export type Status = "pass" | "fail" | "unknown" | "skipped" | "error";
export type Method = "measured" | "heuristic" | "manual" | "ai";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Dimension = "hierarchy" | "layout" | "color" | "interaction" | "responsive" | "accessibility";
export interface Check {
  id: string;
  viewport: string;
  dimension: Dimension;
  method: Method;
  status: Status;
  summary: string;
  evidence: Record<string, unknown>;
}
export interface Issue {
  id: string;
  ruleId: string;
  viewport: string;
  priority: Priority;
  method: Method;
  title: string;
  evidence: Record<string, unknown>;
  suggestion: string;
  selector?: string;
  fingerprint: string;
}
export interface Diagnostic {
  viewport: string;
  kind: "console" | "pageerror" | "requestfailed" | "http" | "blocked" | "navigation" | "environment";
  message: string;
  url?: string;
  origin: "first-party" | "third-party" | "environment" | "unknown";
}
export interface Screenshot {
  viewport: string;
  path: string;
  width: number;
  height: number;
  phase: string;
  capturedAt: string;
  truncated: boolean;
  scenario?: string;
  stepIndex?: number;
  action?: string;
  scope?: "page" | "viewport";
  kind?: "browser" | "diff";
  maskSelectors?: string[];
  maskMissing?: string[];
}
export interface DimensionResult {
  dimension: Dimension;
  weight: number;
  score: null;
  status: "partial" | "unknown";
  executed: number;
  total: number;
  coverage: number;
  issues: string[];
  needsHumanReview: true;
}
export interface Report {
  schemaVersion: "1.0" | "1.1" | "1.2" | "1.3";
  toolVersion?: string;
  execution?: {
    status: "completed" | "timed-out" | "cancelled" | "error";
    timeoutMs: number;
    elapsedMs: number;
  };
  runId: string;
  verificationProfile: string;
  project: string;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  browser: { name: string; version: string };
  viewports: Viewport[];
  status: "pass" | "attention" | "incomplete" | "error";
  checks: Check[];
  issues: Issue[];
  diagnostics: Diagnostic[];
  droppedDiagnostics: Record<string, number>;
  screenshots: Screenshot[];
  summary: {
    executed: number;
    total: number;
    passed: number;
    failed: number;
    unknown: number;
    skipped: number;
    errors: number;
    coverage: number;
    byPriority: Record<Priority, number>;
    aestheticScore: null;
  };
  dimensions: DimensionResult[];
  config: { maxIterations: number; designGoals: string[] };
  limitations: string[];
}
export interface VisualReviewer {
  readonly name: string;
  review(input: {
    screenshots: Screenshot[];
    artifactDirectory: string;
    pageType: string;
    designGoals: string[];
    signal: AbortSignal;
  }): Promise<{
    observations: Array<{
      dimension: Dimension;
      description: string;
      evidence: string;
      suggestion: string;
      confidence: "low" | "medium" | "high";
    }>;
  }>;
}
export function priorityAtLeast(actual: Priority, threshold: ReviewConfig["failOn"]): boolean {
  return threshold !== "none" && Number(actual[1]) <= Number(threshold[1]);
}
