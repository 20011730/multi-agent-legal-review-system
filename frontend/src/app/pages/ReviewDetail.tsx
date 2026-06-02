import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import {
  Scale,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  Loader2,
  Shield,
  Gavel,
  MessageCircle,
  FolderOpen,
} from "lucide-react";
import { EvidenceCardList } from "../components/EvidenceCard";
import { normalizeEvidences } from "../utils/normalizeEvidence";

/* ── 메시지 렌더링 유틸 (Result.tsx와 동일한 로직) ── */
function sanitizeAgentContent(content: string): string {
  if (!content) return content;
  const errorPatterns = [
    /Ollama\s+HTTP\s+\d+[^\n]*/gi,
    /HTTP\s+(4\d\d|5\d\d)[^\n]*/g,
    /Connection\s+refused[^\n]*/gi,
    /Connect(?:ion)?\s+timed?\s*out[^\n]*/gi,
    /설정\/요청\s*오류[^\n]*/g,
    /SocketTimeoutException[^\n]*/g,
    /ResourceAccessException[^\n]*/g,
    /RuntimeException[^\n]*/g,
    /stack trace[^\n]*/gi,
    /raw exception[^\n]*/gi,
    /catastrophic[^\n]*/gi,
    /fallback[^\n]*/gi,
    /API payload[^\n]*/gi,
    /CASE_SEARCH_MODE[^\n]*/g,
    /dataSource[^\n]*/g,
    /vector[^\n]*/gi,
    /similarity[^\n]*/gi,
    /distance[^\n]*/gi,
    /\bscore\s*[:=]?\s*[0-9.]+/gi,
    /판정\s*생성\s*실패[^\n]*/g,
    /AI\s*판정\s*(원문|결과)[^\n]*/g,
    /기본\s*판정[^\n]*/g,
    /파싱(?:에)?\s*실패[^\n]*/g,
  ];
  let sanitized = content;
  let replaced = false;
  for (const pat of errorPatterns) {
    if (pat.test(sanitized)) {
      sanitized = sanitized.replace(pat, "");
      replaced = true;
    }
  }
  if (replaced) {
    sanitized = "일부 AI 응답을 불러오지 못했습니다. 다시 시도하거나 관리자에게 문의해 주세요.";
  }
  return sanitized;
}

function cleanMarkdownForBubble(content: string): string {
  const safe = sanitizeAgentContent(content || "");
  return safe
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\|.*\|$/.test(trimmed)) return false;
      if (/^[-:| ]{3,}$/.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[(?:라운드|Round)\s*\d+[^\]]*\]/gi, "")
    .replace(/\bCSO\s*입장\s*:\s*/gi, "")
    .replace(/최종\s*입장\s*정리/gi, "")
    .replace(/실제\s*수정\s*표현\s*제시\s*\+?\s*합의\s*정리/gi, "")
    .replace(/\bVerdict\s*:\s*\w+/gi, "")
    .replace(/\b(MEDIUM|HIGH|LOW)\b/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactBubbleText(content: string, isJudge = false): { preview: string; detail: string; collapsed: boolean } {
  const cleaned = cleanMarkdownForBubble(content);
  if (!cleaned) return { preview: "일부 AI 응답을 불러오지 못했습니다. 다시 시도하거나 관리자에게 문의해 주세요.", detail: "", collapsed: false };
  const parts = cleaned
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？다요니다까])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const maxChars = isJudge ? 180 : 260;
  const seed = parts.slice(0, isJudge ? 2 : 3).join(" ") || cleaned;
  const preview = seed.length > maxChars ? seed.slice(0, maxChars).trim() + "..." : seed;
  return { preview, detail: cleaned, collapsed: cleaned.length > preview.length + 20 };
}

function renderAgentContent(content: string) {
  const { preview, detail, collapsed } = compactBubbleText(content);
  return (
    <div className="text-sm leading-relaxed text-slate-700">
      <p className="whitespace-pre-wrap break-keep">{preview}</p>
      {collapsed && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-[#1E3A8A] hover:underline">자세히 보기</summary>
          <p className="mt-1 whitespace-pre-wrap break-keep text-[12.5px] leading-relaxed text-slate-600">{detail}</p>
        </details>
      )}
    </div>
  );
}

function renderJudgeContent(content: string) {
  return renderAgentContent(content);
}

interface AgentMessage {
  agentId: string;
  agentName: string;
  content: string;
  type: string;
  round: number;
  stance: string;
  evidenceSummary: string;
}

interface RiskItem {
  category: string;
  level: string;
  description: string;
}

interface FinalDecision {
  verdict: string;
  riskLevel: string;
  risks: RiskItem[];
  summary: string;
  recommendation: string;
  revisedContent: string;
}

interface EvidenceItem {
  sourceType: string;
  title: string;
  referenceId?: string;
  articleOrCourt?: string;
  summary?: string;
  url?: string;
  relevanceReason?: string;
}

interface FollowUpQuestion {
  targetAgent?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
  reanalyzeStatus?: string;
  appliedRound?: number | string;
}

interface AttachmentMeta {
  name?: string;
  mimeType?: string;
  fileType?: string;
  size?: number;
  extractionStatus?: string;
  bodyTruncated?: boolean;
  characterCount?: number;
  originalLength?: number;
  hasBodyText?: boolean;
  priorityKeywords?: string[];
  selectedParagraphCount?: number;
}

interface ReviewDetail {
  sessionId: number;
  companyName: string;
  industry: string;
  reviewType: string;
  situation: string;
  content: string;
  participationMode: string;
  status: string;
  createdAt: string;
  messages: AgentMessage[];
  finalDecision: FinalDecision | null;
  evidences?: EvidenceItem[];
  followUpQuestions?: FollowUpQuestion[];
  attachments?: AttachmentMeta[];
  assistantMessageCount?: number;
}

type TimelineItem =
  | { kind: "messages"; key: string; label: string; messages: AgentMessage[] }
  | { kind: "questions"; key: string; label: string; questions: FollowUpQuestion[] };

const reviewTypeLabels: Record<string, string> = {
  marketing: "마케팅·광고 문구",
  press: "보도자료·공시",
  contract: "계약서·약관",
  policy: "사내 규정·정책",
  communication: "대외 커뮤니케이션",
  decision: "경영 의사결정",
};

const agentConfig: Record<string, { icon: typeof Shield; color: string; bg: string }> = {
  business: { icon: Shield, color: "text-amber-700",  bg: "bg-amber-50 border-amber-200" },
  legal:  { icon: Scale,  color: "text-blue-700",   bg: "bg-blue-50 border-blue-200" },
  risk:   { icon: Shield, color: "text-rose-700",   bg: "bg-rose-50 border-rose-200" },
  ethics: { icon: Gavel,  color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
  judge:  { icon: Gavel,  color: "text-violet-700", bg: "bg-violet-50 border-violet-200" },
};

function resolveAgentId(agentId?: string, agentName?: string, type?: string): string {
  if ((agentId === "judge" || agentId === "ethics") && type === "recommendation") return "judge";
  if (agentId === "risk" && /비즈니스|사업/.test(agentName || "")) return "business";
  if (agentId === "business" || agentId === "risk" || agentId === "legal" || agentId === "judge") return agentId;
  if (agentId === "ethics") return "judge";
  return "legal";
}

const verdictConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  approved: { label: "승인", color: "text-green-700", icon: CheckCircle2 },
  conditional: { label: "조건부 수정 권고", color: "text-amber-700", icon: AlertTriangle },
  rejected: { label: "반려", color: "text-red-700", icon: XCircle },
};

const riskLevelIcon: Record<string, typeof TrendingUp> = {
  HIGH: TrendingUp,
  MEDIUM: Minus,
  LOW: TrendingDown,
};

function messageTypeLabel(type?: string): string {
  switch ((type || "").toLowerCase()) {
    case "analysis":
      return "초기 검토";
    case "concern":
      return "보완 의견";
    case "recommendation":
      return "최종 판정";
    case "system":
      return "시스템 안내";
    case "error":
      return "응답 지연";
    default:
      return type || "";
  }
}

function stanceLabel(stance?: string): string {
  switch ((stance || "").toUpperCase()) {
    case "PRO":
      return "긍정";
    case "CON":
      return "우려";
    case "CAUTION":
      return "주의";
    case "NEUTRAL":
      return "중립";
    default:
      return stance || "";
  }
}

function targetAgentLabel(agent?: string): string {
  switch ((agent || "").toLowerCase().trim()) {
    case "all":
      return "전체 에이전트";
    case "business":
      return "비즈니스 전략가";
    case "legal":
      return "법률 전문가";
    case "risk":
    case "ethics":
      return "리스크 검토자";
    case "judge":
      return "최종 판정관";
    default:
      return agent || "";
  }
}

function safeDisplayText(text?: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  if (/파싱\s*오류|파싱(?:에)?\s*실패|판정\s*결과\s*파싱|판정\s*생성\s*실패|AI\s*판정\s*(원문|결과)|기본\s*판정/.test(t)) {
    return "일부 분석 정보를 불러오지 못했습니다. 잠시 후 다시 시도하거나 전문가 검토와 함께 확인해 주세요.";
  }
  return t.replace(/폴백\s*응답/g, "보조 검토 결과");
}

function statusDisplay(status: string): { label: string; tone: string; description: string } {
  switch (status) {
    case "COMPLETED":
      return { label: "최종 판정 완료", tone: "bg-emerald-100 text-emerald-700", description: "최종 판정과 근거, 상담 기록을 확인할 수 있습니다." };
    case "WAITING_FOR_USER_INPUT":
    case "WAITING_FOR_ROUND2_INPUT":
      return { label: "Round 1 완료 · 사용자 입력 대기", tone: "bg-indigo-100 text-indigo-700", description: "사안 접수 및 초기 쟁점 식별까지 저장되었습니다. 실시간 결과 화면에서 다음 라운드 질문을 입력할 수 있습니다." };
    case "WAITING_FOR_ROUND3_INPUT":
    case "WAITING_FOR_FINAL_INPUT":
      return { label: "Round 2 완료 · 사용자 입력 대기", tone: "bg-violet-100 text-violet-700", description: "사실관계 및 증빙자료 보완 후 법령·판례 근거 검토에 반영할 질문을 입력할 수 있습니다." };
    case "WAITING_FOR_ROUND4_INPUT":
      return { label: "Round 3 완료 · 사용자 입력 대기", tone: "bg-sky-100 text-sky-700", description: "법령·판례 근거 검토 후 반론 검증에 반영할 질문을 입력할 수 있습니다." };
    case "WAITING_FOR_ROUND5_INPUT":
      return { label: "Round 4 완료 · 사용자 입력 대기", tone: "bg-amber-100 text-amber-700", description: "반론 검증 후 종합 의견 및 실행 체크리스트에 반영할 마지막 질문을 입력할 수 있습니다." };
    case "ANALYZING":
    case "REANALYZING":
      return { label: status === "REANALYZING" ? "추가 재검토 진행 중" : "검토 진행 중", tone: "bg-blue-100 text-blue-700", description: "현재까지 생성된 토론 로그를 확인할 수 있습니다." };
    case "FAILED":
      return { label: "검토 중단", tone: "bg-red-100 text-red-700", description: "분석이 정상 완료되지 않았습니다. 저장된 내용만 표시합니다." };
    default:
      return { label: "상태 확인 중", tone: "bg-slate-100 text-slate-700", description: "저장된 세션 상태를 확인하고 있습니다." };
  }
}

function activeFollowUps(questions?: FollowUpQuestion[]) {
  return (questions || []).filter((q) => q.message?.trim() && q.reanalyzeStatus !== "deleted");
}

function followUpsFor(questions: FollowUpQuestion[], appliedRound: string) {
  return questions.filter((q) => String(q.appliedRound ?? "") === appliedRound);
}

function attachmentStatusInfo(att: AttachmentMeta): { label: string; tone: string; detail: string } {
  const status = String(att.extractionStatus || "").toLowerCase();
  const count = typeof att.characterCount === "number" && att.characterCount > 0
    ? `약 ${att.characterCount.toLocaleString("ko-KR")}자`
    : "";
  if (status === "ok" || status === "extracted") {
    return { label: "본문 추출 완료", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", detail: count || "본문이 검토 context에 반영되었습니다." };
  }
  if (status === "partial" || att.bodyTruncated) {
    return { label: "본문 일부 반영", tone: "bg-amber-50 text-amber-700 border-amber-200", detail: count || "긴 문서 중 핵심 부분만 반영되었습니다." };
  }
  if (status === "pending-server-extract") {
    return { label: "본문 추출 대기", tone: "bg-sky-50 text-sky-700 border-sky-200", detail: "분석 중 서버에서 본문 추출을 시도합니다." };
  }
  if (status === "failed-image-or-empty") {
    return { label: "본문 확인 제한", tone: "bg-rose-50 text-rose-700 border-rose-200", detail: "이미지 중심 PDF이거나 읽을 수 있는 텍스트가 부족했습니다." };
  }
  if (status === "failed" || status === "error") {
    return { label: "본문을 충분히 읽지 못했습니다", tone: "bg-rose-50 text-rose-700 border-rose-200", detail: "파일 상태를 확인한 뒤 텍스트가 포함된 문서로 다시 업로드해 주세요." };
  }
  return { label: "메타데이터만 반영", tone: "bg-slate-50 text-slate-600 border-slate-200", detail: "파일명과 형식만 참고되었으며, 본문 내용은 별도 확인이 필요합니다." };
}

function attachmentTypeLabel(att: AttachmentMeta): string {
  const raw = `${att.fileType || ""} ${att.mimeType || ""} ${att.name || ""}`.toLowerCase();
  if (raw.includes("pdf")) return "PDF";
  if (raw.includes("docx") || raw.includes("word")) return "DOCX";
  if (raw.includes("text") || raw.endsWith(".txt")) return "TEXT";
  return "첨부자료";
}

function collapseRepeatedText(text?: string): string {
  const raw = (text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const paragraphs = raw
    .split(/\n{2,}|(?=상황 설명\s*)/)
    .map((part) => part.replace(/^상황 설명\s*/g, "").trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    const seen = new Set<string>();
    return paragraphs
      .filter((part) => {
        const key = part.replace(/\s+/g, " ");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("\n\n");
  }

  const cleaned = raw.replace(/상황 설명\s*/g, "").trim();
  const sentences = cleaned.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];

  if (sentences.length <= 1) return cleaned;

  const seen = new Set<string>();
  const unique = sentences.filter((part) => {
      const key = part.replace(/[.!?。！？]+$/g, "").replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return unique.length === sentences.length ? cleaned : unique.join(" ");
}

export function ReviewDetailPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"debate" | "verdict">("debate");

  useEffect(() => {
    if (!sessionId) {
      navigate("/reviews");
      return;
    }

    fetch(`http://localhost:8080/api/reviews/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("조회 실패");
        return res.json();
      })
      .then((data) => setDetail(data))
      .catch((err) => {
        console.error("검토 상세 조회 실패:", err);
        setError("검토 내용을 불러오는데 실패했습니다.");
      })
      .finally(() => setIsLoading(false));
  }, [sessionId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F2F2F2] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1E3A8A] animate-spin" />
        <span className="ml-3 text-slate-500">불러오는 중...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-[#F2F2F2] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "데이터를 찾을 수 없습니다"}</p>
          <Button
            onClick={() => navigate("/reviews")}
            className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
          >
            목록으로
          </Button>
        </div>
      </div>
    );
  }

  const fd = detail.finalDecision;
  const vc = fd ? verdictConfig[fd.verdict] : null;
  const VerdictIcon = vc?.icon;
  const displaySituation = collapseRepeatedText(detail.situation);
  const displayContent = collapseRepeatedText(detail.content);
  const showContent = displayContent && displayContent.replace(/\s+/g, " ") !== displaySituation.replace(/\s+/g, " ");

  const followUps = activeFollowUps(detail.followUpQuestions);
  const round2Questions = followUpsFor(followUps, "2");
  const round3Questions = followUpsFor(followUps, "3");
  const round4Questions = followUpsFor(followUps, "4");
  const round5Questions = followUpsFor(followUps, "5");
  const reanalysisQuestions = followUpsFor(followUps, "reanalysis");
  const hasFiveRoundLog = detail.messages.some((msg) => Number(msg.round) >= 4);
  const messagesByRound = (round: number) => detail.messages.filter((msg) => Number(msg.round) === round);
  const reanalysisMessages = detail.messages.filter((msg) => Number(msg.round) > (hasFiveRoundLog ? 5 : 3));
  const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
  const reflectedAttachments = attachments.filter((att) => {
    const status = String(att.extractionStatus || "").toLowerCase();
    return Boolean(att.hasBodyText || status === "ok" || status === "extracted" || status === "partial");
  });
  const limitedAttachments = attachments.filter((att) => {
    const status = String(att.extractionStatus || "").toLowerCase();
    return status === "failed" || status === "error" || status === "failed-image-or-empty" || status === "skipped-unsupported";
  });
  const timelineItems: TimelineItem[] = [];
  const pushMessages = (key: string, label: string, messages: AgentMessage[]) => {
    if (messages.length > 0) timelineItems.push({ kind: "messages", key, label, messages });
  };
  const pushQuestions = (key: string, label: string, questions: FollowUpQuestion[]) => {
    if (questions.length > 0) timelineItems.push({ kind: "questions", key, label, questions });
  };
  pushMessages("round1", hasFiveRoundLog ? "Round 1 · 사안 접수 및 초기 쟁점 식별" : "Round 1 · 초기 검토", messagesByRound(1));
  pushQuestions("user-round2", "사용자 추가 질문 1차", round2Questions);
  pushMessages("round2", hasFiveRoundLog ? "Round 2 · 사실관계 및 증빙자료 보완" : "Round 2 · 사용자 질문 반영 토론", messagesByRound(2));
  pushQuestions("user-round3", "사용자 추가 질문 2차", round3Questions);
  pushMessages("round3", hasFiveRoundLog ? "Round 3 · 법령·판례 근거 검토" : "Round 3 · 최종 토론 및 판단", messagesByRound(3));
  if (hasFiveRoundLog) {
    pushQuestions("user-round4", "사용자 추가 질문 3차", round4Questions);
    pushMessages("round4", "Round 4 · 반론 검증 및 리스크 시나리오 분석", messagesByRound(4));
    pushQuestions("user-round5", "사용자 추가 질문 4차", round5Questions);
    pushMessages("round5", "Round 5 · 종합 의견 및 실행 체크리스트", messagesByRound(5));
  }
  pushQuestions("user-reanalysis", "추가 재검토 요청", reanalysisQuestions);
  pushMessages("reanalysis", "추가 재검토 결과", reanalysisMessages);
  const statusInfo = statusDisplay(detail.status);

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-5 md:px-7 flex items-center justify-between h-[74px]">
          <button
            onClick={() => navigate("/")}
            className="min-w-[220px] text-left py-1"
          >
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
            onClick={() => navigate("/reviews")}
          >
            히스토리
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-[1240px] w-full mx-auto px-5 md:px-6 py-12 md:py-14">
        {/* Back + title */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/reviews")}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            검토 기록으로 돌아가기
          </button>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">
              검토 상세
            </h2>
            {vc && VerdictIcon && (
              <Badge className={`${vc.color} border`}>
                <VerdictIcon className="w-4 h-4 mr-1" />
                {vc.label}
              </Badge>
            )}
          </div>
        </div>

        <Card className="border-slate-200 bg-white shadow-sm rounded-3xl mb-6 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              검토 요청 정보
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-slate-500">기업명</p>
                <p className="font-medium text-slate-900">{detail.companyName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">검토 유형</p>
                <p className="font-medium text-slate-900">
                  {reviewTypeLabels[detail.reviewType] || detail.reviewType}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">요청 일시</p>
                <p className="font-medium text-slate-900">
                  {new Date(detail.createdAt).toLocaleDateString("ko-KR", {
                    year: "numeric", month: "long", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1">상황 설명</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{displaySituation}</p>
            </div>
            {showContent && (
              <div>
                <p className="text-xs text-slate-500 mb-1">검토 원문</p>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{displayContent}</p>
                </div>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <Badge className={statusInfo.tone}>{statusInfo.label}</Badge>
              {followUps.length > 0 && <Badge variant="outline" className="bg-indigo-50 text-indigo-700">사용자 추가 질문 {followUps.length}건</Badge>}
              {reanalysisQuestions.length > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700">추가 재검토 요청 {reanalysisQuestions.length}건</Badge>}
              {attachments.length > 0 && (
                <Badge variant="outline" className="bg-sky-50 text-sky-700">
                  첨부자료 {attachments.length}건 · 본문 반영 {reflectedAttachments.length}건
                </Badge>
              )}
              {(detail.evidences?.length || 0) > 0 && <Badge variant="outline" className="bg-emerald-50 text-emerald-700">근거 {detail.evidences?.length}건</Badge>}
              {(detail.assistantMessageCount || 0) > 0 && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  <MessageCircle className="mr-1 h-3 w-3" />비서 상담 기록 있음
                </Badge>
              )}
              <p className="basis-full text-xs text-slate-500">{statusInfo.description}</p>
              {detail.status !== "COMPLETED" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 rounded-full"
                  onClick={() => {
                    sessionStorage.setItem("sessionId", String(detail.sessionId));
                    sessionStorage.setItem("currentSessionId", String(detail.sessionId));
                    navigate("/result");
                  }}
                >
                  실시간 검토 화면으로 이동
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {attachments.length > 0 && (
          <Card className="border-slate-200 bg-white shadow-sm rounded-3xl mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-sky-700" />
                첨부자료 반영 상태
              </CardTitle>
              <CardDescription>
                사용자가 올린 파일의 본문 처리 상태입니다. 법령·판례 근거 카드와는 별도로 표시됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700">본문 반영 {reflectedAttachments.length}건</Badge>
                {limitedAttachments.length > 0 && (
                  <Badge variant="outline" className="bg-rose-50 text-rose-700">확인 제한 {limitedAttachments.length}건</Badge>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {attachments.map((att, idx) => {
                  const status = attachmentStatusInfo(att);
                  const keywords = Array.isArray(att.priorityKeywords) ? att.priorityKeywords.slice(0, 5) : [];
                  return (
                    <div key={`${att.name || "attachment"}-${idx}`} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="bg-white text-slate-700">{attachmentTypeLabel(att)}</Badge>
                        <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="break-all text-sm font-medium text-slate-900">{safeDisplayText(att.name || `첨부자료 ${idx + 1}`)}</p>
                      <p className="mt-1 text-xs text-slate-600">{status.detail}</p>
                      {keywords.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {keywords.map((keyword) => (
                            <span key={keyword} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600">
                              {safeDisplayText(keyword)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "debate" ? "default" : "outline"}
            onClick={() => setActiveTab("debate")}
            className={
              activeTab === "debate"
                ? "rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                : "rounded-full border-[#64748B]/35 text-slate-700 hover:bg-white"
            }
          >
            토론 내용
          </Button>
          <Button
            variant={activeTab === "verdict" ? "default" : "outline"}
            onClick={() => setActiveTab("verdict")}
            className={
              activeTab === "verdict"
                ? "rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                : "rounded-full border-[#64748B]/35 text-slate-700 hover:bg-white"
            }
          >
            최종 판정
          </Button>
        </div>

        {activeTab === "debate" && (
          <div className="space-y-6">
            {timelineItems.length === 0 && (
              <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardContent className="py-10 text-center text-sm text-slate-500">
                  아직 표시할 토론 로그가 없습니다.
                </CardContent>
              </Card>
            )}
            {timelineItems.map((section) => (
              <Card key={section.key} className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {section.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {section.kind === "questions" && section.questions.map((question, idx) => (
                    <div key={idx} className="ml-auto max-w-[760px] rounded-2xl rounded-br-sm border border-[#1E3A8A]/20 bg-[#1E3A8A]/5 p-4">
                      <div className="mb-2 flex items-center justify-end gap-2">
                        <Badge variant="outline" className="border-[#1E3A8A]/30 text-[#1E3A8A]">사용자 추가 질문</Badge>
                        {question.targetAgent && question.targetAgent !== "all" && (
                          <Badge variant="outline" className="text-xs">대상: {targetAgentLabel(question.targetAgent)}</Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-keep text-sm leading-relaxed text-slate-800">
                        {safeDisplayText(question.message)}
                      </p>
                    </div>
                  ))}
                  {section.kind === "messages" && section.messages.map((msg, idx) => {
                    const resolvedId = resolveAgentId(msg.agentId, msg.agentName, msg.type);
                    const ac = agentConfig[resolvedId] || agentConfig.legal;
                    const AgentIcon = ac.icon;
                    const isJudge = resolvedId === "judge";
                    return (
                      <div key={idx} className={`p-4 rounded-xl border ${ac.bg}`}>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <AgentIcon className={`w-4 h-4 ${ac.color}`} />
                          <span className={`font-medium text-sm ${ac.color}`}>
                            {msg.agentName}
                          </span>
                          {stanceLabel(msg.stance) && (
                            <Badge variant="outline" className="text-xs">
                              {stanceLabel(msg.stance)}
                            </Badge>
                          )}
                          {messageTypeLabel(msg.type) && (
                            <Badge variant="outline" className="text-xs">
                              {messageTypeLabel(msg.type)}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1">
                          {isJudge ? renderJudgeContent(msg.content) : renderAgentContent(msg.content)}
                        </div>
                        {msg.evidenceSummary && (
                          <p className="text-xs text-slate-500 mt-2">
                            근거: {safeDisplayText(msg.evidenceSummary)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeTab === "verdict" && !fd && (
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <p className="text-slate-700 font-medium mb-1">최종 판정 정보가 아직 없습니다.</p>
                <p className="text-sm text-slate-500">
                  {detail.status === "COMPLETED"
                    ? "분석이 완료되었지만 판정 데이터가 저장되지 않았습니다. 새로 검토를 시작해 주세요."
                    : "분석이 진행 중이거나 미완료 상태입니다. 분석이 끝난 뒤 다시 확인해 주세요."}
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <Button variant="outline" onClick={() => navigate("/reviews")}>목록으로</Button>
                  <Button
                    onClick={() => navigate("/input")}
                    className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
                  >
                    새 검토 시작
                  </Button>
                </div>
              </CardContent>
            </Card>
            {/* 판정이 없어도 evidence가 있으면 일관되게 표시 */}
            <EvidenceCardList evidences={normalizeEvidences(detail)} />
          </div>
        )}

        {activeTab === "verdict" && fd && (
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
              <CardHeader>
                <CardTitle>판정 요약</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {vc && VerdictIcon ? (
                    <div className="flex items-center gap-2">
                      <VerdictIcon className={`w-6 h-6 ${vc.color}`} />
                      <span className={`text-lg font-semibold ${vc.color}`}>
                        {vc.label}
                      </span>
                    </div>
                  ) : fd.verdict ? (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-6 h-6 text-slate-500" />
                      <span className="text-lg font-semibold text-slate-700">{fd.verdict}</span>
                    </div>
                  ) : null}
                  {fd.riskLevel && (
                    <Badge className={
                      fd.riskLevel === "HIGH" ? "bg-red-100 text-red-700" :
                      fd.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" :
                      "bg-green-100 text-green-700"
                    }>
                      위험도: {fd.riskLevel}
                    </Badge>
                  )}
                </div>
                {fd.summary
                  ? <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{safeDisplayText(fd.summary)}</p>
                  : <p className="text-sm text-slate-400">요약이 제공되지 않았습니다.</p>}
              </CardContent>
            </Card>

            {Array.isArray(fd.risks) && fd.risks.length > 0 && (
              <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle>위험 요소</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {fd.risks.map((risk, idx) => {
                      const lvl = (risk.level || "").toLowerCase();
                      const RiskIcon = riskLevelIcon[(risk.level || "").toUpperCase()] || Minus;
                      return (
                        <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                          <RiskIcon className={`w-5 h-5 mt-0.5 ${
                            lvl === "high" ? "text-red-600" :
                            lvl === "medium" ? "text-amber-600" :
                            "text-green-600"
                          }`} />
                          <div>
                            <p className="font-medium text-sm text-slate-900">{safeDisplayText(risk.category)}</p>
                            <p className="text-sm text-slate-600">{safeDisplayText(risk.description)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {(fd.recommendation || fd.revisedContent) && (
              <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
                <CardHeader>
                  <CardTitle>권고사항</CardTitle>
                </CardHeader>
                <CardContent>
                  {fd.recommendation && (
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed mb-4">{safeDisplayText(fd.recommendation)}</p>
                  )}
                  {fd.revisedContent && (
                    <>
                      {fd.recommendation && <Separator className="my-4" />}
                      <div>
                        <p className="text-sm font-medium text-slate-900 mb-2">수정 제안 문구</p>
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                          <p className="text-sm text-green-900 whitespace-pre-wrap">{fd.revisedContent}</p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Legal Evidences — 공통 컴포넌트 사용 */}
            <EvidenceCardList evidences={normalizeEvidences(detail)} />

            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/reviews")}
              >
                목록으로
              </Button>
              <Button
                onClick={() => navigate("/input")}
                className="rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
              >
                새 검토 시작
              </Button>
            </div>
          </div>
        )}
      </main>
      <footer className="border-t border-[#64748B]/25 bg-[#F2F2F2] mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
