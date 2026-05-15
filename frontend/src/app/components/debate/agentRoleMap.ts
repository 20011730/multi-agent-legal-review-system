import type { LucideIcon } from "lucide-react";
import { BarChart3, Briefcase, Gavel, Headphones, Shield } from "lucide-react";

export type CanonicalAgentRole =
  | "secretary"
  | "moderator"
  | "legal_counsel"
  | "business_strategy"
  | "data_analyst"
  | "system";

export interface AgentRolePresentation {
  role: CanonicalAgentRole;
  displayName: string;
  subtitle: string;
  icon: LucideIcon;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}

const secretary: AgentRolePresentation = {
  role: "secretary",
  displayName: "전담 비서",
  subtitle: "사용자 보조",
  icon: Headphones,
  colorClass: "text-indigo-800",
  bgClass: "bg-indigo-50",
  borderClass: "border-indigo-200",
};

const moderator: AgentRolePresentation = {
  role: "moderator",
  displayName: "수석 조율관",
  subtitle: "진행 및 판정",
  icon: Gavel,
  colorClass: "text-violet-800",
  bgClass: "bg-violet-50",
  borderClass: "border-violet-200",
};

const legalCounsel: AgentRolePresentation = {
  role: "legal_counsel",
  displayName: "법무 담당관",
  subtitle: "법률 · 방패",
  icon: Shield,
  colorClass: "text-rose-800",
  bgClass: "bg-rose-50",
  borderClass: "border-rose-200",
};

const businessStrategy: AgentRolePresentation = {
  role: "business_strategy",
  displayName: "비즈니스 전략관",
  subtitle: "실무 · 창",
  icon: Briefcase,
  colorClass: "text-teal-800",
  bgClass: "bg-teal-50",
  borderClass: "border-teal-200",
};

const dataAnalyst: AgentRolePresentation = {
  role: "data_analyst",
  displayName: "데이터 분석관",
  subtitle: "판례 · 팩트",
  icon: BarChart3,
  colorClass: "text-slate-700",
  bgClass: "bg-slate-100",
  borderClass: "border-slate-300",
};

const systemFallback: AgentRolePresentation = {
  role: "system",
  displayName: "시스템",
  subtitle: "안내",
  icon: BarChart3,
  colorClass: "text-slate-600",
  bgClass: "bg-slate-50",
  borderClass: "border-slate-200",
};

/**
 * 백엔드 agentId·agentName을 확정된 5인 체제 UI 표현으로 정규화합니다.
 */
export function resolveAgentPresentation(agentId: string, agentName?: string): AgentRolePresentation {
  const id = (agentId || "").trim().toLowerCase();
  const name = (agentName || "").trim().toLowerCase();

  if (id === "system" || id === "error") {
    return { ...systemFallback, displayName: id === "error" ? "오류 안내" : "시스템" };
  }

  if (
    id === "assistant" ||
    id === "secretary" ||
    id === "clerk" ||
    id === "user_assistant" ||
    name.includes("전담 비서") ||
    name.includes("비서")
  ) {
    return secretary;
  }

  if (
    id === "judge" ||
    id === "ethics" ||
    id === "moderator" ||
    id === "coordinator" ||
    name.includes("판정") ||
    name.includes("조율")
  ) {
    return moderator;
  }

  if (id === "legal" || name.includes("법무") || name.includes("법률")) {
    return legalCounsel;
  }

  if (
    id === "risk" ||
    id === "biz" ||
    id === "business" ||
    name.includes("비즈니스") ||
    name.includes("전략")
  ) {
    return businessStrategy;
  }

  if (
    id === "data" ||
    id === "analyst" ||
    id === "analytics" ||
    id === "research" ||
    name.includes("데이터") ||
    name.includes("분석관") ||
    name.includes("판례")
  ) {
    return dataAnalyst;
  }

  return systemFallback;
}
