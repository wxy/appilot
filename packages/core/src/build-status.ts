import type { AscBuild, AscVersion } from "./asc-api";

export type BuildState = "processing" | "available" | "inBetaReview" | "rejected" | "unknown";

export interface BuildStatusInfo {
  state: BuildState;
  label: string;
  nextStep: string | null;
}

const PROCESSING_STATES = new Set(["PROCESSING", "WAITING_EXPORT_COMPLIANCE_REVIEW"]);
const REJECTED_STATES = new Set(["FAILED", "INVALID", "EXPORT_COMPLIANCE_REJECTED"]);
const AVAILABLE_STATES = new Set(["VALID", "ACTIVE", "EXPORT_COMPLIANCE_APPROVED"]);
const BETA_IN_REVIEW = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "IN_BETA_REVIEW"]);

export function mapBuildState(
  processingState?: string | null,
  betaReviewState?: string | null,
): BuildState {
  const beta = betaReviewState || "";
  if (beta === "REJECTED") return "rejected";
  if (BETA_IN_REVIEW.has(beta)) return "inBetaReview";
  if (beta === "APPROVED") return "available";
  const processing = processingState || "";
  if (PROCESSING_STATES.has(processing)) return "processing";
  if (REJECTED_STATES.has(processing)) return "rejected";
  if (AVAILABLE_STATES.has(processing)) return "available";
  return "unknown";
}

export function suggestedNextStep(state: BuildState): { label: string; kind: "info" | "warning" } | null {
  switch (state) {
    case "processing":
      return { label: "构建仍在处理中，请稍后再检查", kind: "info" };
    case "inBetaReview":
      return { label: "TestFlight 审核中，通过后即可挂载到版本", kind: "info" };
    case "available":
      return { label: "构建可用，可在 App Store Connect 挂载到版本并提交", kind: "info" };
    case "rejected":
      return { label: "构建被拒/无效，请检查构建配置", kind: "warning" };
    default:
      return null;
  }
}

function buildStateLabel(state: BuildState): string {
  switch (state) {
    case "processing": return "构建处理中";
    case "available": return "构建可用";
    case "inBetaReview": return "TestFlight 审核中";
    case "rejected": return "构建被拒";
    default: return "构建状态未知";
  }
}

export function buildStatusForVersion(
  version: AscVersion | null,
  builds: AscBuild[],
): BuildStatusInfo | null {
  if (!version) return null;
  const match = builds.find((build) =>
    version.buildId ? build.id === version.buildId : build.version === version.versionString,
  );
  if (!match) {
    return {
      state: "unknown",
      label: "未找到匹配构建",
      nextStep: "前往 App Store Connect 上传并挂载构建",
    };
  }
  const state = mapBuildState(match.processingState, match.betaReviewState);
  const next = suggestedNextStep(state);
  return { state, label: buildStateLabel(state), nextStep: next?.label || null };
}
