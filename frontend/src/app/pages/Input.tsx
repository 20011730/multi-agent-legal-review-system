import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
// Phase 10.6 — RadioGroup / Eye 미사용 (관찰/참여 모드 제거됨)
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AlertCircle, ArrowLeft, ArrowRight, Building2, FileText, FolderOpen, MessageSquare, Sparkles, Upload } from "lucide-react";
import { SuggestionChips, appendSuggestion } from "../components/SuggestionChips";
import {
  extractAttachments,
  attachmentsToPayload,
  type ExtractedAttachment,
} from "../utils/attachmentBody";
import {
  recommendedAttachmentsFor,
  type RecommendedAttachment,
} from "../utils/recommendedAttachments";

// 정적 추천 문구 — 정/규칙 기반. 사용자가 빈 입력창에서 출발점을 잡도록 보조.
// reviewType / participationMode 별로 micro-맞춤 가능하지만 1차 MVP 는 공통 set.
const SITUATION_SUGGESTIONS = [
  "투자 유치를 앞두고 IR 자료/공시 문구의 법적 리스크를 점검하려 합니다.",
  "신규 출시 직전 마케팅 문구의 과장 광고/허위 광고 위험을 미리 진단하고자 합니다.",
  "계약 갱신 협상 전 핵심 조항(해지/면책/배상 한도) 의 불리한 조건을 확인하고 싶습니다.",
];
const CONTENT_SUGGESTIONS = [
  "본 서비스는 업계 최저가를 보장하며 어떠한 사용자에게도 동일한 혜택을 제공합니다.",
  "제1조 (계약의 해지) — 당사는 사전 통지 없이 본 계약을 언제든지 해지할 수 있습니다.",
  "결제는 자동 갱신되며, 환불은 어떠한 사유로도 제공되지 않습니다.",
];

const personaCategories = [
  {
    id: "contract",
    label: "계약·거래",
    desc: "투자 계약서, 공급 약관, 서비스 이용약관 리스크 검토",
  },
  {
    id: "ip",
    label: "지식재산·브랜드",
    desc: "상표권, 특허, 저작권 확보 및 타사 권리 침해 여부 진단",
  },
  {
    id: "data",
    label: "개인정보·데이터",
    desc: "개인정보 수집·활용, 제3자 제공 및 데이터 보안 규제 준수",
  },
  {
    id: "regulation",
    label: "규제·인허가",
    desc: "신사업 인허가 취득, 규제 샌드박스 및 업종별 법규 대응",
  },
  {
    id: "labor",
    label: "인사·노무",
    desc: "근로계약서, 취업규칙, 스톡옵션 부여 및 노사 분쟁 예방",
  },
  {
    id: "funding",
    label: "투자·자금조달",
    desc: "투자 조건(Term Sheet) 분석, 주주간 계약 및 투자자 관계",
  },
  {
    id: "operations",
    label: "기업운영·법무",
    desc: "지배구조(정관), 내부통제, 경영권 방어 및 법인 운영",
  },
  {
    id: "rechallenge",
    label: "사업정리·재도전",
    desc: "폐업 절차, 법인 청산, 회생·파산 및 재창업 법률 지원",
  },
];

const stepMeta = [
  { id: 1, title: "카테고리 선택" },
  { id: 2, title: "기업 정보 입력" },
  { id: 3, title: "상세 상황 기술" },
  { id: 4, title: "진단 시작" },
] as const;

/** Phase 10 — /startup-support 상세 모달에서 전달받는 컨텍스트. */
interface StartupContext {
  id?: string;
  title?: string;
  organization?: string;
  category?: string;
  target?: string;
  fieldSummary?: string;
  deadline?: string;
  applyUrl?: string;
  source?: string;
  aiInsightHint?: string;
  legalReviewHint?: string;
}

/**
 * Phase 10.9 — Step 3 라벨/placeholder 카테고리(reviewType) + 진단 목적 기반 동적 매핑.
 */
function step3Labels(scenarioCategory: string, purpose: string, hasStartupContext: boolean = false): {
  situationLabel: string;
  situationPlaceholder: string;
  contentLabel: string;
  contentPlaceholder: string;
} {
  // Phase 10.36 — startupContext 존재 시 강제로 지원사업 라벨 사용.
  // 라이브 QA 에서 자동 입력 후 scenarioCategory 가 "data" 로 잘못 매핑되어
  // "개인정보 처리방침" 라벨이 노출되던 버그 수정.
  if (hasStartupContext) {
    return {
      situationLabel: "신청·수행 예정 상황 *",
      situationPlaceholder:
        "신청 예정인 지원사업, 우리 팀의 진행 단계, 협약 체결 여부, 우려되는 점을 구체적으로 적어주세요.",
      contentLabel: "공고문/협약서/사업계획 핵심 내용 *",
      contentPlaceholder:
        "공고문, 협약서, 사업비 집행 기준, 성과물 귀속 조항 등을 붙여 넣으세요.",
    };
  }
  // 우선순위: 진단 목적 → 카테고리 → 기본
  if (purpose === "startup-support" || scenarioCategory === "contract") {
    return {
      situationLabel: "신청·수행 예정 상황 *",
      situationPlaceholder:
        "신청 예정인 지원사업, 우리 팀의 진행 단계, 협약 체결 여부, 우려되는 점을 구체적으로 적어주세요.",
      contentLabel: "공고문/협약서/사업계획 핵심 내용 *",
      contentPlaceholder:
        "공고문, 협약서, 사업비 집행 기준, 성과물 귀속 조항 등을 붙여 넣으세요.",
    };
  }
  if (purpose === "investment" || scenarioCategory === "funding") {
    return {
      situationLabel: "투자 검토 배경 *",
      situationPlaceholder: "투자 단계, 투자자 유형, 우리 팀의 우려(지분 희석/경영권 등)를 적어주세요.",
      contentLabel: "검토할 term sheet / 주주간계약 조항 *",
      contentPlaceholder: "우선주·상환권·전환권·동의권 등 검토할 핵심 조항을 붙여 넣으세요.",
    };
  }
  if (purpose === "privacy-data" || scenarioCategory === "data") {
    return {
      situationLabel: "수집·이용하려는 데이터와 서비스 흐름 *",
      situationPlaceholder: "수집 항목, 이용 목적, 보관 기간, 제3자 제공/국외 이전 여부를 적어주세요.",
      contentLabel: "개인정보 처리방침 / 동의 문구 / 데이터 제공 조건 *",
      contentPlaceholder: "검토할 처리방침 본문, 동의 문구, 위탁 계약 조항 등을 붙여 넣으세요.",
    };
  }
  if (purpose === "ip" || scenarioCategory === "ip") {
    return {
      situationLabel: "개발·제작·연구 수행 구조 *",
      situationPlaceholder: "개발 주체, 외주/직원/공동개발 여부, 정부지원 과제 산출물 여부를 적어주세요.",
      contentLabel: "성과물/IP 귀속 관련 조항 *",
      contentPlaceholder: "특허/저작권/소스코드 귀속, 사용권 범위, 공동권리 조항 등을 붙여 넣으세요.",
    };
  }
  if (purpose === "labor" || scenarioCategory === "labor") {
    return {
      situationLabel: "인력 활용 방식 *",
      situationPlaceholder:
        "근로자/프리랜서/외주 구분, 업무 지휘·감독 여부, 보수 지급 방식 등을 적어주세요.",
      contentLabel: "근로계약/용역계약/프리랜서 계약 조항 *",
      contentPlaceholder: "비밀유지·경업금지·해지·결과물 소유권 등 검토할 조항을 붙여 넣으세요.",
    };
  }
  if (scenarioCategory === "regulation") {
    return {
      situationLabel: "사업 / 서비스 / 인허가 검토 배경 *",
      situationPlaceholder: "어떤 산업·서비스이며 어떤 규제·인허가 영역인지 적어주세요.",
      contentLabel: "검토할 관련 규정/공지/요건 *",
      contentPlaceholder: "관련 법령·고시·가이드라인 또는 검토 대상 문구를 붙여 넣으세요.",
    };
  }
  // 기본 (광고/마케팅 등)
  return {
    situationLabel: "상황 설명 *",
    situationPlaceholder: "현재 상황, 배경, 쟁점, 우려사항을 구체적으로 적어주세요.",
    contentLabel: "검토할 문서/문구/조항 *",
    contentPlaceholder: "계약 조항, 공지 문구, 대외 문서, 광고 문구 등의 핵심 내용을 입력하세요.",
  };
}

/**
 * Phase 10.28 — Step 3 의 SuggestionChips 예시를 카테고리/맥락별로 다르게 제공.
 * SITUATION_SUGGESTIONS / CONTENT_SUGGESTIONS 가 광고/계약 중심이라 다른 카테고리에선 부자연스럽던 문제 해결.
 * startupContext 가 있으면 지원사업 시나리오 우선.
 */
function categoryChips(scenarioCategory: string, hasStartupContext: boolean): {
  situationChips: string[];
  contentChips: string[];
} {
  if (hasStartupContext) {
    return {
      situationChips: [
        "지원사업 신청 전 협약 체결 조건과 사업비 집행 기준을 미리 검토하고 싶습니다.",
        "선정 후 협약서·사업계획서·예산 산출내역서 작성 시 유의사항을 확인하고 싶습니다.",
        "성과물/IP 귀속과 외주·용역·청년채용 의무 등 수행 단계 리스크를 점검하고 싶습니다.",
      ],
      contentChips: [
        "공고문 핵심 조건 — 지원 자격·제외 기준·신청 절차·접수 마감일.",
        "협약서 초안 핵심 — 사업비 정산·환수 사유·해지·성과물 귀속 조항.",
        "사업계획서 초안 핵심 — 사업비 사용 계획·성과 목표·외주 비중.",
      ],
    };
  }
  switch (scenarioCategory) {
    case "data":
      return {
        situationChips: [
          "서비스 운영 중 수집되는 개인정보 항목과 이용 목적, 보관 기간을 검토하고 싶습니다.",
          "위탁/제3자 제공 계약과 동의 문구의 적정성을 확인하고 싶습니다.",
          "해외 이전·민감정보·자동화 처리 관련 컴플라이언스를 점검하고 싶습니다.",
        ],
        contentChips: [
          "개인정보 처리방침 — 수집 항목·이용 목적·보관 기간·제3자 제공.",
          "동의 문구 — 필수/선택 구분, 명시성, 철회 방법.",
          "처리위탁 계약 — 위탁 업무 범위·수탁자·재위탁 여부.",
        ],
      };
    case "ip":
      return {
        situationChips: [
          "공동연구·외주 개발 결과물의 권리 귀속과 사용권 범위를 검토하고 싶습니다.",
          "상표·특허·저작권 확보와 침해 리스크를 점검하고 싶습니다.",
          "오픈소스 사용 컴플라이언스와 라이선스 충돌을 확인하고 싶습니다.",
        ],
        contentChips: [
          "공동연구·협약서 — 성과물 귀속·사용권·실시료 조항.",
          "외주·용역 계약 — 결과물 권리·납품·수정요청권.",
          "오픈소스 사용 내역 — 라이선스 종류·재배포 조건.",
        ],
      };
    case "labor":
      return {
        situationChips: [
          "프리랜서/외주 인력이 실제 근무 형태상 근로자성에 가까운지 검토하고 싶습니다.",
          "보수·세금·4대보험 처리와 비밀유지·경업금지 조항을 점검하고 싶습니다.",
          "산출물 권리 귀속과 계약 해지 시 분쟁 가능성을 확인하고 싶습니다.",
        ],
        contentChips: [
          "근로계약서 — 업무 범위·근무 장소/시간·보수·해지.",
          "외주·용역 계약 — 도급/위탁 구분·성과물 귀속·검수.",
          "사내 규정 — 비밀유지·경업금지·스톡옵션·해지 사유.",
        ],
      };
    case "funding":
      return {
        situationChips: [
          "Term Sheet 또는 투자계약서의 우선주·상환권·전환권 조건을 검토하고 싶습니다.",
          "주주간계약상 동의권·태그/드래그·우선매수 등 창업자 제한을 점검하고 싶습니다.",
          "후속 투자·M&A 시 발생할 수 있는 동의 요건과 희석 효과를 확인하고 싶습니다.",
        ],
        contentChips: [
          "Term Sheet — 투자금액·밸류·우선주·전환·청산우선권.",
          "주주간계약 — 동의권·우선매수·태그/드래그·이사회 구성.",
          "정관 — 종류주식·전환조건·이사회 권한.",
        ],
      };
    case "regulation":
      return {
        situationChips: [
          "신사업 모델이 필요한 인허가/신고 요건을 충족하는지 검토하고 싶습니다.",
          "관련 고시·가이드라인·자율규제 준수 여부를 점검하고 싶습니다.",
          "표시광고·전자상거래·소비자보호 규제 적용 가능성을 확인하고 싶습니다.",
        ],
        contentChips: [
          "사업 개요 / 서비스 흐름도 — 인허가 범위 매핑용.",
          "관련 법령·고시 — 적용 조항 발췌.",
          "기존 인·허가 사본 또는 변경 신청 내용.",
        ],
      };
    default:
      // 광고/계약 등 — 기존 SITUATION_SUGGESTIONS / CONTENT_SUGGESTIONS 와 유사한 기본 set
      return {
        situationChips: [
          "신규 출시 직전 마케팅 문구의 과장 광고/허위 광고 위험을 미리 진단하고자 합니다.",
          "계약 갱신 협상 전 핵심 조항(해지/면책/배상 한도)의 불리한 조건을 확인하고 싶습니다.",
          "투자 유치를 앞두고 IR 자료/공시 문구의 법적 리스크를 점검하려 합니다.",
        ],
        contentChips: [
          "본 서비스는 업계 최저가를 보장하며 어떠한 사용자에게도 동일한 혜택을 제공합니다.",
          "제1조 (계약의 해지) — 당사는 사전 통지 없이 본 계약을 언제든지 해지할 수 있습니다.",
          "결제는 자동 갱신되며, 환불은 어떠한 사유로도 제공되지 않습니다.",
        ],
      };
  }
}

/**
 * Phase 10.28 — Step 2 카테고리별 helper text. 진단 목적 상세 입력란 아래에 안내.
 * 사용자가 어떤 정보를 채우면 좋은지 카테고리 맥락에서 짧게 안내.
 */
function step2HelperByCategory(scenarioCategory: string, hasStartupContext: boolean): string {
  if (hasStartupContext) {
    return "📌 지원사업 신청·수행 관점: 협약 체결 조건, 사업비 집행/정산, 성과물·IP 귀속, 외주·고용, 개인정보 처리, 중복 수혜·환수 가능성을 함께 적어 주시면 더 정확한 검토가 가능합니다.";
  }
  switch (scenarioCategory) {
    case "contract":
      return "📌 계약 검토: 계약 목적, 상대방 유형, 대금/지급 일정, 해지·환불·위약금, 손해배상·책임 제한, 자동 갱신 여부를 함께 입력하면 좋습니다.";
    case "ip":
      return "📌 지식재산·브랜드: 대상 권리(상표/특허/저작권/영업비밀), 권리 보유자, 공동개발/외주 여부, 성과물 귀속, 라이선스 범위를 함께 입력하면 좋습니다.";
    case "data":
      return "📌 개인정보·데이터: 수집 항목, 이용 목적, 동의 방식, 보관 기간, 제3자 제공/처리위탁/국외 이전 여부를 함께 입력하면 좋습니다.";
    case "regulation":
      return "📌 규제·인허가: 사업 분야, 필요한 인허가, 판매·제공 지역, 대상 고객, 관련 고시/가이드라인을 함께 입력하면 좋습니다.";
    case "labor":
      return "📌 인사·노무: 근로자/프리랜서/외주 구분, 업무 지시 방식, 근무 장소·시간, 보수 지급 방식, 4대보험 여부, 산출물 권리를 함께 입력하면 좋습니다.";
    case "funding":
      return "📌 투자·자금조달: 투자 형태, 투자자 유형, 지분/전환/상환 조건, 주요 주주 권리, 우선주/SAFE/CB 여부, 동반매도·우선매수권을 함께 입력하면 좋습니다.";
    case "operation":
      return "📌 기업운영·법무: 정관/주주간계약, 이사회/주총, 내부 승인 절차, 대표 권한, 이해상충 가능성을 함께 입력하면 좋습니다.";
    case "exit":
      return "📌 사업정리·재도전: 폐업/청산/회생 여부, 미지급 채무, 임직원 정리, 고객 계약 종료, 데이터 파기, 지원금 정산/환수를 함께 입력하면 좋습니다.";
    default:
      return "📌 진단 목적과 함께 상황·우려 사항을 구체적으로 적어 주시면 에이전트들이 핵심 리스크를 더 정확히 식별할 수 있습니다.";
  }
}

/** Phase 10.7 — 진단 목적별 상세 입력 placeholder 동적 매핑. */
function purposePlaceholder(purpose: string): string {
  switch (purpose) {
    case "startup-support":
      return "예: 지원사업 신청 전 협약 체결 조건, 사업비 집행·정산, 성과물/IP 귀속, 외주·고용 계약, 개인정보 처리, 환수 가능성을 검토하고 싶습니다.";
    case "investment":
      return "예: 투자 조건, 지분 희석, 우선주·상환권·전환권, 경영권 제한, 투자자 동의권을 검토하고 싶습니다.";
    case "privacy-data":
      return "예: 서비스 운영 중 수집·보관·제3자 제공되는 개인정보와 데이터 처리 위탁, 보안 조치, 동의 문구를 검토하고 싶습니다.";
    case "ip":
      return "예: 상표·특허·저작권 확보, 공동연구 성과물 귀속, 사용권 범위, 침해 리스크를 검토하고 싶습니다.";
    case "labor":
      return "예: 근로계약, 도급·위탁 구분, 청년채용 의무, 비밀유지·경업금지, 임금 조건 노무 리스크를 검토하고 싶습니다.";
    case "toxic-terms":
      return "예: 계약서의 해지·면책·배상한도·자동갱신·환불 제한 조항을 검토하고 싶습니다.";
    case "compliance-check":
      return "예: 신사업 인허가·표시광고법·전자상거래법·소비자보호 규제 준수 여부를 확인하고 싶습니다.";
    case "dispute-response":
      return "예: 거래처와의 분쟁 상황에서 대응 전략과 협상 카드를 정리하고 싶습니다.";
    case "risk-screening":
      return "예: 사업 전반의 핵심 법률 리스크를 빠르게 스크리닝하고 우선순위를 정리하고 싶습니다.";
    case "custom":
      return "원하는 진단 목적을 직접 입력하세요";
    default:
      return "원하는 진단 목적과 검토하려는 핵심 사항을 자유롭게 입력하세요";
  }
}

/** Phase 10.7 — 진단 목적별 helper text. */
function purposeHelper(purpose: string): string {
  switch (purpose) {
    case "startup-support":
      return "공고문/협약서/사업계획서 원문이 있으면 Step 3 에 함께 붙여 넣어 주세요.";
    case "investment":
      return "Term Sheet, 주주간계약서, 정관, cap table 등을 첨부하면 더 정확합니다.";
    case "privacy-data":
      return "개인정보 처리방침 / 데이터 처리 위탁 계약 / 동의 문구 원본을 함께 검토합니다.";
    case "ip":
      return "공동연구 협약서, 출원 명세서, 사용권 계약서 등을 함께 검토합니다.";
    case "labor":
      return "근로계약서, 외주계약서, 사내 규정 원본을 함께 검토하면 정확도가 향상됩니다.";
    case "":
      return "선택한 진단 목적에 맞춰 에이전트가 검토 우선순위를 정리합니다.";
    default:
      return "선택한 진단 목적에 맞춰 에이전트가 검토 우선순위를 정리합니다.";
  }
}

export function InputPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Phase 10.1 — startup-support 상세에서 전달된 공고 정보. location.state 우선, sessionStorage fallback.
  const startupContext: StartupContext | undefined = useMemo(() => {
    const fromState = (location.state as { startupContext?: StartupContext } | null)?.startupContext;
    if (fromState) {
      try {
        sessionStorage.setItem("lexrex.startupContext", JSON.stringify(fromState));
      } catch {
        /* ignore */
      }
      return fromState;
    }
    try {
      const cached = sessionStorage.getItem("lexrex.startupContext");
      return cached ? (JSON.parse(cached) as StartupContext) : undefined;
    } catch {
      return undefined;
    }
  }, [location.state]);

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scenarioCategory, setScenarioCategory] = useState("contract");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  /** Phase 10.19 — 본문 추출/마스킹 결과. attachedFiles 와 1:1 매칭. */
  const [extractedAttachments, setExtractedAttachments] = useState<ExtractedAttachment[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);

  const [formData, setFormData] = useState<Record<string, string>>({
    companyName: "",
    growthStage: "",
    industry: "",
    diagnosticPurpose: "",
    customPurpose: "",
    counterpartyInfo: "",
    reviewType: "contract",
    situation: "",
    content: "",
    participationMode: "participate",   // Phase 10.6 — 관찰 모드 제거, 항상 participate
    // Phase 10.13 — 지원사업형 추가 선택 필드 (startupContext 있을 때만 표시)
    applicantType: "",
    executionMode: "",
    privacyHandling: "",
    ipOutput: "",
    workforce: "",
    priorSupport: "",
  });

  // Phase 10.6 — startupContext 키워드 기반 카테고리 자동 선택. 빈 컨텍스트는 영향 없음.
  useEffect(() => {
    if (!startupContext) return;
    const hay = [
      startupContext.title,
      startupContext.fieldSummary,
      startupContext.category,
      startupContext.target,
      startupContext.aiInsightHint,
      startupContext.legalReviewHint,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Phase 10.46 — 지원사업 카테고리 분류. 다양한 공고 성격을 더 적절한 검토 영역에 매핑.
    //   기본은 "contract"(계약·거래) — 지원사업 협약·정산 검토 흐름과 가장 잘 맞음.
    //   특정 강한 시그널이 있을 때만 다른 카테고리로 이동.
    let cat = "contract";
    if (/지식재산|특허|상표|저작권|성과물|\br&d\b|tips|기술개발|연구개발|기술이전|시제품|디딤돌|기술사업화|사업화|지식서비스/i.test(hay)) cat = "ip";
    else if (/고용|채용|인력|외주|용역|근로|컨설팅 수행 인력/i.test(hay)) cat = "labor";
    else if (/인허가|인증|규제|샌드박스|의료|헬스케어|핀테크|허가|승인/i.test(hay)) cat = "regulation";
    else if (/개인정보|프라이버시|개인 ?정보|처리방침|고객정보|민감정보|개인식별/i.test(hay)) cat = "data";
    // 창업/사업화/수출/ESG/컨설팅 — 별도 카테고리 없음 → 기본 "계약·거래"(협약/정산 흐름) 유지
    // else: 협약/사업비/정산/환수 → 계약·거래 (기본)

    setScenarioCategory(cat);
    setFormData((prev) => ({
      ...prev,
      reviewType: cat,
      diagnosticPurpose: prev.diagnosticPurpose || "custom",
      customPurpose:
        prev.customPurpose ||
        `지원사업 협약·정산·IP·고용 리스크 사전 검토 (${startupContext.title ?? "공고 미상"})`,
    }));
  }, [startupContext]);

  /** Phase 10.3 — startupContext 기반 situation/content 초안 텍스트 생성. 사용자가 버튼 누를 때만 채움. */
  const buildStartupDrafts = (ctx: StartupContext) => {
    const situationDraft =
      `저희 팀은 "${ctx.title ?? "(공고명 미상)"}" 지원사업 신청을 검토 중입니다.` +
      (ctx.organization ? ` 주관 기관은 ${ctx.organization}이며,` : "") +
      (ctx.target ? ` 지원 대상은 "${ctx.target}"입니다.` : "") +
      `\n\n신청 전 다음 사항에 대한 법률 리스크를 사전 점검하고 싶습니다 — 협약 체결 조건, 사업비 집행·정산, 성과물/지식재산권 귀속, 외주·고용 계약, 개인정보 처리, 중도 포기 또는 환수 가능성, 중복 수혜 제한.` +
      (ctx.deadline ? `\n접수 마감일은 ${ctx.deadline} 입니다.` : "");
    const contentDraft =
      (ctx.fieldSummary ? `[지원 분야 / 내용 요약]\n${ctx.fieldSummary}\n\n` : "") +
      `[추가 검토 자료]\n` +
      `사업계획서, 협약서, 공고문 원문, 팀 구성, 외주 계약 여부 등 실제 자료를 본 입력란에 붙여 넣거나 아래 첨부 영역에 업로드하시면 더 정확한 진단이 가능합니다.` +
      (ctx.applyUrl ? `\n\n원본 공고: ${ctx.applyUrl}` : "");
    return { situationDraft, contentDraft };
  };

  /** Phase 10.7 — 자동 입력 적용 상태 + 적용 직전 값 백업(되돌리기용). */
  const [draftApplied, setDraftApplied] = useState(false);
  const [draftBackup, setDraftBackup] = useState<{ situation: string; content: string } | null>(null);
  const [draftToast, setDraftToast] = useState<string>("");
  /** Phase 10.14 — 3-way confirm dialog state: "merge" | "overwrite" | null (closed). */
  const [draftConfirmOpen, setDraftConfirmOpen] = useState<false | "open">(false);
  /** Phase 10.15 — 민감정보 검출 React 모달 (window.confirm 대체). */
  const [sensitiveModalOpen, setSensitiveModalOpen] = useState(false);

  /**
   * Phase 10.14 — "지원사업 정보로 입력 초안 만들기" 클릭 핸들러.
   * 기존 입력이 있으면 3-way 모달(merge/overwrite/cancel) 열기, 없으면 즉시 적용.
   */
  const handleFillStartupDraft = () => {
    if (!startupContext) return;
    const hasExisting =
      formData.situation.trim() !== "" || formData.content.trim() !== "";
    if (hasExisting && !draftApplied) {
      setDraftConfirmOpen("open");
      return;
    }
    applyStartupDraft(false /* merge mode */);
  };

  /** Phase 10.14 — 실제 적용 (mode: 'overwrite' | 'merge'). */
  const applyStartupDraft = (overwrite: boolean) => {
    if (!startupContext) return;
    const { situationDraft, contentDraft } = buildStartupDrafts(startupContext);
    const hadSituation = formData.situation.trim() !== "";
    const hadContent = formData.content.trim() !== "";
    setFormData((prev) => {
      setDraftBackup({ situation: prev.situation, content: prev.content });
      return {
        ...prev,
        situation: overwrite || prev.situation.trim() === "" ? situationDraft : prev.situation,
        content: overwrite || prev.content.trim() === "" ? contentDraft : prev.content,
      };
    });
    setDraftApplied(true);
    setDraftConfirmOpen(false);

    const filledFields: string[] = [];
    if (!hadSituation || overwrite) filledFields.push("신청·수행 예정 상황");
    if (!hadContent || overwrite) filledFields.push("공고 핵심 내용");
    filledFields.push("카테고리", "진단 목적");
    const mode = overwrite && (hadSituation || hadContent) ? " (덮어쓰기)" : " (빈 항목만 채움)";
    setDraftToast(`${filledFields.join(", ")} 항목이 채워졌습니다${mode}. 필요에 맞게 수정하세요.`);
    window.setTimeout(() => setDraftToast(""), 6000);
  };

  /** 초안 되돌리기 — 적용 직전 값으로 복원. */
  const handleRevertStartupDraft = () => {
    if (!draftBackup) return;
    setFormData((prev) => ({
      ...prev,
      situation: draftBackup.situation,
      content: draftBackup.content,
    }));
    setDraftApplied(false);
    setDraftBackup(null);
    setDraftToast("자동 입력을 되돌렸습니다.");
    window.setTimeout(() => setDraftToast(""), 4000);
  };

  /** "지원사업 정보만 초기화" — sessionStorage + state 만 비우고 자동 입력값은 유지. */
  const handleClearStartupContext = () => {
    try {
      sessionStorage.removeItem("lexrex.startupContext");
    } catch {
      /* ignore */
    }
    setDraftApplied(false);
    setDraftBackup(null);
    navigate("/input", { replace: true, state: null });
  };

  /** "지원사업 정보 + 자동 입력 모두 초기화" — 폼까지 비우고 일반 진단 흐름 복귀. */
  const handleClearAllStartupData = () => {
    try {
      sessionStorage.removeItem("lexrex.startupContext");
    } catch {
      /* ignore */
    }
    setFormData((prev) => ({
      ...prev,
      situation: "",
      content: "",
      customPurpose: "",
      diagnosticPurpose: "",
      counterpartyInfo: "",
    }));
    setDraftApplied(false);
    setDraftBackup(null);
    navigate("/input", { replace: true, state: null });
  };

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (!userStr) {
      navigate("/login");
      return;
    }

    const user = JSON.parse(userStr);
    fetch(`http://localhost:8080/api/users/${user.id}/profile`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setFormData((prev) => ({
            ...prev,
            companyName: data.companyName || user.companyName || "",
            industry: data.industry || "",
          }));
        } else {
          setFormData((prev) => ({ ...prev, companyName: user.companyName || "" }));
        }
      })
      .catch(() => {
        setFormData((prev) => ({ ...prev, companyName: user.companyName || "" }));
      });
  }, [navigate]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    // Phase 10.19 — 즉시 메타만 추가해 UI 반응성 확보, 본문 추출은 비동기
    const merged = [...attachedFiles, ...files].slice(0, 5);
    setAttachedFiles(merged);

    setExtractingAttachments(true);
    try {
      const extracted = await extractAttachments(merged);
      setExtractedAttachments(extracted);
    } catch (e) {
      console.warn("[attachment] 추출 처리 실패:", e);
    } finally {
      setExtractingAttachments(false);
    }
  };

  const removeAttachment = (idx: number) => {
    const nextFiles = attachedFiles.filter((_, i) => i !== idx);
    const nextExtracted = extractedAttachments.filter((_, i) => i !== idx);
    setAttachedFiles(nextFiles);
    setExtractedAttachments(nextExtracted);
  };

  const isStepValid = useMemo(() => {
    if (currentStep === 1) return Boolean(scenarioCategory);
    if (currentStep === 2) {
      if (!formData.companyName || !formData.growthStage || !formData.industry || !formData.diagnosticPurpose) {
        return false;
      }
      if (formData.diagnosticPurpose === "custom" && !formData.customPurpose.trim()) return false;
      return true;
    }
    if (currentStep === 3) {
      // Phase 10.6 — participationMode 는 항상 participate 로 고정 → 검증 항목에서 제외
      return Boolean(formData.situation && formData.content);
    }
    return true;
  }, [currentStep, formData, scenarioCategory]);

  const handleNextStep = () => {
    if (!isStepValid) return;
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !isStepValid || currentStep !== 4) return;

    // Phase 10.15 — 민감정보 패턴 검출 시 React 모달 (window.confirm 대체)
    const sensitivePatterns = [
      /API[_-]?KEY\s*[=:]/i,
      /service[_-]?Key\s*[=:]/i,
      /password\s*[=:]/i,
      /secret\s*[=:]/i,
      /\btoken\s*[=:]/i,
      /\bbearer\s+[A-Za-z0-9._\-]{16,}/i,
      /\b\d{6}-?\d{7}\b/,
      /\b\d{3}-?\d{2,6}-?\d{4,8}\b/,
    ];
    const combinedText = `${formData.situation}\n${formData.content}\n${formData.customPurpose}`;
    const hits = sensitivePatterns.filter((p) => p.test(combinedText));
    if (hits.length > 0) {
      // 모달 열고 함수 종료. 사용자가 "그래도 진행" 누르면 performSubmit() 호출.
      setSensitiveModalOpen(true);
      return;
    }
    await performSubmit();
  };

  /** Phase 10.15 — 실제 submit 동작을 별도 함수로 분리 (모달 confirm 후 호출 가능). */
  const performSubmit = async () => {
    setSensitiveModalOpen(false);
    setIsSubmitting(true);

    // Phase 10.3 — startupContext 있으면 진단 payload + reviewData 양쪽 모두에 동봉
    const payloadForSession: Record<string, unknown> = {
      companyName: formData.companyName,
      industry: formData.industry,
      reviewType: scenarioCategory,
      situation: formData.situation,
      content: formData.content,
      participationMode: formData.participationMode,
    };
    // Phase 10.19 — recommendedAttachments 산출 (UI/payload 공통)
    const recAttachments: RecommendedAttachment[] = recommendedAttachmentsFor({
      startupContextPresent: Boolean(startupContext),
      scenarioCategory,
      startupExtras: {
        applicantType: formData.applicantType,
        executionMode: formData.executionMode,
        privacyHandling: formData.privacyHandling,
        ipOutput: formData.ipOutput,
        workforce: formData.workforce,
        priorSupport: formData.priorSupport,
      },
      reviewType: scenarioCategory,
    });

    if (startupContext) {
      payloadForSession.startupContext = startupContext;
      // Phase 10.13 — 지원사업형 추가 정보 (선택 입력) 도 컨텍스트에 동봉
      const extras: Record<string, unknown> = {};
      if (formData.applicantType) extras.applicantType = formData.applicantType;
      if (formData.executionMode) extras.executionMode = formData.executionMode;
      if (formData.privacyHandling) extras.privacyHandling = formData.privacyHandling;
      if (formData.ipOutput) extras.ipOutput = formData.ipOutput;
      if (formData.workforce) extras.workforce = formData.workforce;
      if (formData.priorSupport) extras.priorSupport = formData.priorSupport;
      // Phase 10.19 — 추천 첨부자료도 startupExtras 에 동봉 → backend/Python prompt 가 활용 가능
      if (recAttachments.length > 0) {
        extras.recommendedAttachments = recAttachments;
      }
      if (Object.keys(extras).length > 0) {
        payloadForSession.startupExtras = extras;
      }
    } else if (recAttachments.length > 0) {
      // 지원사업 컨텍스트 없을 때도 추천 자료는 startupExtras 에 보존 (Python AI 가 무시해도 무방)
      payloadForSession.startupExtras = { recommendedAttachments: recAttachments };
    }

    // Phase 10.19 — 첨부 메타데이터 + 본문 추출 결과 동봉
    if (extractedAttachments.length > 0) {
      payloadForSession.attachments = attachmentsToPayload(extractedAttachments);
    } else if (attachedFiles.length > 0) {
      // 추출이 아직 완료되지 않은 fallback — 최소 메타데이터만
      payloadForSession.attachments = attachedFiles.map((file) => ({
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
        extractionStatus: "skipped-unsupported",
        bodyTruncated: false,
        sensitivityFlags: [],
      }));
    }

    sessionStorage.setItem(
      "reviewData",
      JSON.stringify({
        ...formData,
        scenarioCategory,
        attachedFileNames: attachedFiles.map((file) => file.name),
        attachments: attachedFiles.map((file) => ({
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        })),
        ...(startupContext ? { startupContext } : {}),
      }),
    );

    try {
      const user = JSON.parse(localStorage.getItem("legalreview_currentUser") || "{}");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user.id) headers["X-User-Id"] = String(user.id);

      const res = await fetch("http://localhost:8080/api/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(payloadForSession),
      });
      const data = await res.json();
      sessionStorage.setItem("sessionId", String(data.sessionId));
    } catch (err) {
      console.error("Session creation failed:", err);
    }

    setIsSubmitting(false);
    navigate("/result");
  };

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="min-w-[220px] text-left py-1">
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-slate-600 mb-4 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" /> 홈으로 돌아가기
        </button>

        <div className="mb-8">
          <h2 className="text-3xl font-semibold text-[#1E3A8A]">법률 리스크 진단 센터</h2>
          <p className="text-slate-600 mt-2">
            단계별 입력을 통해 AI 에이전트가 맥락을 정확히 파악하도록 구성합니다.
          </p>
        </div>

        {/* Phase 10.15 — 민감정보 검출 React 모달 (window.confirm 대체) */}
        {sensitiveModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sensitive-modal-title"
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/45 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSensitiveModalOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="sensitive-modal-title" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-rose-900">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                민감정보가 포함되었을 수 있습니다
              </h3>
              <p className="mb-4 text-sm leading-relaxed text-slate-600">
                입력 내용에서 API Key / 비밀번호 / 토큰 / 주민등록번호 / 계좌번호 패턴이 감지되었습니다.
                <br />
                필요한 범위만 가리고 진행하시는 것을 권장합니다.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setSensitiveModalOpen(false)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-left text-sm hover:border-[#1E3A8A]/40 hover:bg-slate-50"
                >
                  <div className="font-medium text-slate-900">돌아가서 민감정보 가리기 (권장)</div>
                  <div className="text-xs text-slate-500">입력 영역에서 민감정보를 마스킹한 뒤 다시 시작</div>
                </button>
                <button
                  type="button"
                  onClick={() => { void performSubmit(); }}
                  className="w-full rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-left text-sm hover:bg-rose-100"
                >
                  <div className="font-medium text-rose-900">그래도 이대로 진단 시작</div>
                  <div className="text-xs text-rose-700">입력값은 그대로 백엔드로 전송됩니다</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 10.14 — 3-way 자동 입력 confirm 모달 */}
        {draftConfirmOpen === "open" && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-confirm-title"
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/45 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDraftConfirmOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="draft-confirm-title" className="mb-1.5 text-base font-semibold text-slate-900">
                현재 입력한 내용이 있습니다
              </h3>
              <p className="mb-4 text-sm leading-relaxed text-slate-600">
                지원사업 정보 기반 초안을 어떻게 적용할지 선택해 주세요.
                <br />
                기존 입력은 "되돌리기"로 복구 가능합니다.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => applyStartupDraft(false)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-left text-sm hover:border-[#1E3A8A]/40 hover:bg-slate-50"
                >
                  <div className="font-medium text-slate-900">기존 입력 유지 + 빈 항목만 채우기</div>
                  <div className="text-xs text-slate-500">이미 작성한 내용을 보존합니다 (권장)</div>
                </button>
                <button
                  type="button"
                  onClick={() => applyStartupDraft(true)}
                  className="w-full rounded-lg border border-[#1E3A8A] bg-[#1E3A8A] px-4 py-2.5 text-left text-sm text-white hover:bg-[#16306f]"
                >
                  <div className="font-medium">지원사업 초안으로 덮어쓰기</div>
                  <div className="text-xs opacity-80">기존 작성 내용을 새 초안으로 대체합니다 (되돌리기 가능)</div>
                </button>
                <button
                  type="button"
                  onClick={() => setDraftConfirmOpen(false)}
                  className="w-full rounded-lg border border-transparent px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Phase 10.7 — 컨텍스트 배너 (draftApplied/되돌리기/전체 초기화 + toast) */}
        {startupContext && (
          <>
            <StartupContextBanner
              ctx={startupContext}
              onFillDraft={handleFillStartupDraft}
              onRevertDraft={handleRevertStartupDraft}
              onClearContext={handleClearStartupContext}
              onClearAll={handleClearAllStartupData}
              canFillDraft={true /* Phase 10.26 — 항상 활성화. 3-way 모달이 기존 입력 처리. 되돌리기 후에도 비활성화 X */}
              draftApplied={draftApplied}
              canRevert={draftBackup !== null}
            />
            {draftToast && (
              <div
                role="status"
                aria-live="polite"
                className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"
              >
                ✓ {draftToast}
              </div>
            )}
            {/* Phase 10.12 — 적용된 항목 chip 리스트 (적용 후만 표시) */}
            {draftApplied && (
              <div className="mb-4 rounded-lg border border-[#1E3A8A]/20 bg-white px-4 py-2.5">
                <p className="mb-1.5 text-[11px] font-semibold text-[#1E3A8A]">자동 입력된 항목</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    "카테고리",
                    "진단 목적",
                    "진단 목적 상세",
                    "신청·수행 예정 상황",
                    "공고 핵심 내용",
                    "추천 첨부 자료",
                  ].map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-800"
                    >
                      ✓ {label}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[10.5px] text-slate-500">
                  필요에 맞게 직접 수정할 수 있습니다. 직접 수정한 값은 "초안 다시 만들기"로 덮어쓰지 않는 한 유지됩니다.
                </p>
              </div>
            )}
          </>
        )}

        <div className="grid sm:grid-cols-4 gap-2 mb-6">
          {stepMeta.map((step) => (
            <div
              key={step.id}
              className={`rounded-xl border px-3 py-2 text-sm ${
                currentStep === step.id
                  ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <p className="font-semibold">Step {step.id}</p>
              <p className="text-xs mt-0.5">{step.title}</p>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {currentStep === 1 && (
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#1E3A8A]" />
                  Step 1. 상황 카테고리 선택
                </CardTitle>
                <CardDescription>아래 8개 카테고리 중 진단하려는 핵심 영역을 선택하세요.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {personaCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        setScenarioCategory(category.id);
                        setFormData((prev) => ({ ...prev, reviewType: category.id }));
                      }}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        scenarioCategory === category.id
                          ? "border-[#1E3A8A] bg-[#1E3A8A]/5"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <p className="font-semibold text-sm">{category.label}</p>
                      <p className="text-xs text-slate-600 mt-1">{category.desc}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {currentStep === 2 && (
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-[#1E3A8A]" />
                  Step 2. 기업 정보 입력
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">기업명 *</Label>
                  <Input
                    id="companyName"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  />
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="growthStage">기업 성장 단계 *</Label>
                    <Select
                      value={formData.growthStage}
                      onValueChange={(value) => setFormData({ ...formData, growthStage: value })}
                    >
                      <SelectTrigger id="growthStage">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pre-startup">예비창업</SelectItem>
                        <SelectItem value="seed">시드</SelectItem>
                        <SelectItem value="series-a">시리즈 A</SelectItem>
                        <SelectItem value="series-b+">시리즈 B 이상</SelectItem>
                        <SelectItem value="scale-up">스케일업</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="industry">핵심 산업군 *</Label>
                    <Select
                      value={formData.industry}
                      onValueChange={(value) => setFormData({ ...formData, industry: value })}
                    >
                      <SelectTrigger id="industry">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fintech">핀테크</SelectItem>
                        <SelectItem value="healthcare">헬스케어</SelectItem>
                        <SelectItem value="edutech">에듀테크</SelectItem>
                        <SelectItem value="ecommerce">이커머스</SelectItem>
                        <SelectItem value="saas">SaaS</SelectItem>
                        <SelectItem value="mobility">모빌리티</SelectItem>
                        <SelectItem value="etc">기타</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="diagnosticPurpose">진단 목적 *</Label>
                    <Select
                      value={formData.diagnosticPurpose}
                      onValueChange={(value) => setFormData({ ...formData, diagnosticPurpose: value })}
                    >
                      <SelectTrigger id="diagnosticPurpose">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="startup-support">정부지원사업 규정 준수 검토</SelectItem>
                        <SelectItem value="investment">투자 계약 검토</SelectItem>
                        <SelectItem value="privacy-data">개인정보/데이터 처리 검토</SelectItem>
                        <SelectItem value="ip">지식재산권/브랜드 검토</SelectItem>
                        <SelectItem value="labor">인사·노무·외주 검토</SelectItem>
                        <SelectItem value="toxic-terms">계약서 독소조항 탐지</SelectItem>
                        <SelectItem value="compliance-check">규제 준수 여부 확인</SelectItem>
                        <SelectItem value="dispute-response">분쟁 대응 시나리오</SelectItem>
                        <SelectItem value="risk-screening">사전 리스크 스크리닝</SelectItem>
                        <SelectItem value="custom">직접 입력</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="counterpartyInfo">
                      {startupContext ? "주관기관/전담기관" : "상대방 정보"}
                    </Label>
                    <Input
                      id="counterpartyInfo"
                      value={formData.counterpartyInfo}
                      onChange={(e) => setFormData({ ...formData, counterpartyInfo: e.target.value })}
                      placeholder={startupContext ? "예: 창업진흥원, 중소벤처기업진흥공단" : "예: VC, 대기업, 개인 고객"}
                    />
                  </div>
                </div>
                {/* Phase 10.7 — 진단 목적 상세 입력은 항상 표시 (조건부 렌더링 제거) */}
                <div className="space-y-2">
                  <Label htmlFor="customPurpose">
                    진단 목적 상세 입력 {formData.diagnosticPurpose === "custom" && "*"}
                  </Label>
                  <Input
                    id="customPurpose"
                    value={formData.customPurpose}
                    onChange={(e) => setFormData({ ...formData, customPurpose: e.target.value })}
                    placeholder={purposePlaceholder(formData.diagnosticPurpose)}
                  />
                  <p className="text-[11px] text-slate-500">
                    {purposeHelper(formData.diagnosticPurpose)}
                  </p>
                </div>
                {/* Phase 10.28 — Step 2 카테고리별 helper panel */}
                <div className="mt-2 rounded-md border border-[#1E3A8A]/15 bg-[#1E3A8A]/5 px-3 py-2 text-[11.5px] leading-relaxed text-[#1E3A8A]/90">
                  {step2HelperByCategory(scenarioCategory, Boolean(startupContext))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phase 10.13 — Step 2 에서 startupContext 가 있을 때만 노출되는 지원사업형 추가 필드 */}
          {currentStep === 2 && startupContext && (
            <Card className="border-[#1E3A8A]/20 bg-[#1E3A8A]/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="w-4 h-4 text-[#1E3A8A]" />
                  지원사업 진단 추가 정보 (선택)
                </CardTitle>
                <CardDescription>
                  더 정확한 검토를 위해 지원사업 신청·수행 관련 정보를 알려주세요. 모든 항목은 선택사항입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1.5">
                    <Label htmlFor="applicantType">신청 주체 유형</Label>
                    <Select
                      value={formData.applicantType || ""}
                      onValueChange={(v) => setFormData({ ...formData, applicantType: v })}
                    >
                      <SelectTrigger id="applicantType">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="individual">개인사업자</SelectItem>
                        <SelectItem value="corporation">법인</SelectItem>
                        <SelectItem value="pre-startup">예비창업자</SelectItem>
                        <SelectItem value="consortium">컨소시엄</SelectItem>
                        <SelectItem value="etc">기타</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="executionMode">수행 방식</Label>
                    <Select
                      value={formData.executionMode || ""}
                      onValueChange={(v) => setFormData({ ...formData, executionMode: v })}
                    >
                      <SelectTrigger id="executionMode">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in-house">자체 수행</SelectItem>
                        <SelectItem value="outsourcing">외주 포함</SelectItem>
                        <SelectItem value="joint-research">공동연구 포함</SelectItem>
                        <SelectItem value="undecided">아직 미정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="privacyHandling">개인정보 처리 여부</Label>
                    <Select
                      value={formData.privacyHandling || ""}
                      onValueChange={(v) => setFormData({ ...formData, privacyHandling: v })}
                    >
                      <SelectTrigger id="privacyHandling">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        <SelectItem value="customer">고객정보 처리</SelectItem>
                        <SelectItem value="employee">직원·참여자 정보 처리</SelectItem>
                        <SelectItem value="sensitive">민감정보 가능성 있음</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ipOutput">성과물 / IP 발생 여부</Label>
                    <Select
                      value={formData.ipOutput || ""}
                      onValueChange={(v) => setFormData({ ...formData, ipOutput: v })}
                    >
                      <SelectTrigger id="ipOutput">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        <SelectItem value="software">소프트웨어</SelectItem>
                        <SelectItem value="dataset">데이터셋</SelectItem>
                        <SelectItem value="report">보고서</SelectItem>
                        <SelectItem value="ip-rights">특허·상표</SelectItem>
                        <SelectItem value="joint">공동성과물</SelectItem>
                        <SelectItem value="undecided">미정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="workforce">고용 · 외주 인력 활용</Label>
                    <Select
                      value={formData.workforce || ""}
                      onValueChange={(v) => setFormData({ ...formData, workforce: v })}
                    >
                      <SelectTrigger id="workforce">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        <SelectItem value="employee">직원</SelectItem>
                        <SelectItem value="freelancer">프리랜서</SelectItem>
                        <SelectItem value="vendor">용역업체</SelectItem>
                        <SelectItem value="research-institute">연구기관</SelectItem>
                        <SelectItem value="undecided">미정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="priorSupport">기존 지원사업 수혜 여부</Label>
                    <Select
                      value={formData.priorSupport || ""}
                      onValueChange={(v) => setFormData({ ...formData, priorSupport: v })}
                    >
                      <SelectTrigger id="priorSupport">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        <SelectItem value="yes">있음</SelectItem>
                        <SelectItem value="check-needed">확인 필요</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  ※ 위 정보는 협약·정산·IP·개인정보·고용·중복수혜 리스크 검토 우선순위 결정에 활용됩니다.
                </p>
              </CardContent>
            </Card>
          )}

          {currentStep === 3 && (
            <>
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#1E3A8A]" />
                    Step 3. 상세 상황 기술
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Phase 10.9 — 카테고리 + 진단 목적 기반 동적 라벨/placeholder */}
                  {(() => {
                    const labels = step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext));
                    return null; /* labels 는 아래에서 사용 */
                  })()}
                  <div className="space-y-2">
                    <Label htmlFor="situation">
                      {step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext)).situationLabel}
                    </Label>
                    <Textarea
                      id="situation"
                      value={formData.situation}
                      onChange={(e) => setFormData({ ...formData, situation: e.target.value })}
                      className="min-h-[120px]"
                      placeholder={
                        startupContext
                          ? "위의 '지원사업 정보로 입력 초안 만들기' 버튼으로 자동 채우거나, 직접 작성하세요. " +
                            step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext)).situationPlaceholder
                          : step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext)).situationPlaceholder
                      }
                    />
                    {/* Phase 10.28 — 카테고리/맥락별 chip */}
                    <SuggestionChips
                      title="자주 입력하는 상황 예시"
                      items={categoryChips(scenarioCategory, Boolean(startupContext)).situationChips}
                      onApply={(t) =>
                        setFormData((prev) => ({ ...prev, situation: appendSuggestion(prev.situation, t) }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="content">
                      {step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext)).contentLabel}
                    </Label>
                    <Textarea
                      id="content"
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className="min-h-[180px]"
                      placeholder={step3Labels(scenarioCategory, formData.diagnosticPurpose, Boolean(startupContext)).contentPlaceholder}
                    />
                    {/* Phase 10.28 — 카테고리/맥락별 chip */}
                    <SuggestionChips
                      title={startupContext ? "공고/협약 핵심 내용 예시" : "검토 대상 문구 예시"}
                      items={categoryChips(scenarioCategory, Boolean(startupContext)).contentChips}
                      onApply={(t) =>
                        setFormData((prev) => ({ ...prev, content: appendSuggestion(prev.content, t) }))
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-[#1E3A8A]" />
                    관련 문서 업로드
                  </CardTitle>
                  <CardDescription>계약서(PDF), 공문, 협약서 등 — 현재 데모 단계는 파일명/메타데이터 중심으로 분석에 반영됩니다.</CardDescription>
                </CardHeader>
                <CardContent>
                  <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <Upload className="w-6 h-6 mx-auto text-slate-500 mb-2" />
                    <p className="text-sm text-slate-700">파일 선택 또는 드래그</p>
                    <input type="file" className="hidden" multiple onChange={handleFileChange} />
                  </label>
                  <div className="mt-3 space-y-2">
                    {extractingAttachments && (
                      <p className="text-[11px] text-slate-500">파일 본문 추출 중...</p>
                    )}
                    {attachedFiles.map((file, idx) => {
                      const ex = extractedAttachments[idx];
                      const sizeKb = (file.size / 1024).toFixed(1);
                      const statusLabel = (() => {
                        if (!ex) return "대기 중";
                        if (ex.extractionStatus === "ok") return ex.bodyTruncated ? "본문 일부 반영" : "본문 반영";
                        // Phase 10.51 — PDF/DOCX 는 서버에서 본문 추출 → 분석 시작 시 결과 확정
                        if (ex.extractionStatus === "pending-server-extract") return "본문 분석 가능 (PDF/DOCX)";
                        if (ex.extractionStatus === "skipped-unsupported") return "메타데이터만 반영";
                        if (ex.extractionStatus === "skipped-too-large") return "용량 초과 — 메타만";
                        return "추출 실패";
                      })();
                      const statusColor =
                        ex?.extractionStatus === "ok"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : ex?.extractionStatus === "pending-server-extract"
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : ex?.extractionStatus === "error"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-slate-50 text-slate-600 border-slate-200";
                      return (
                        <div
                          key={`${file.name}-${idx}`}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
                        >
                          <FolderOpen className="w-4 h-4 text-slate-500" />
                          <span className="font-medium">{file.name}</span>
                          <span className="text-[11px] text-slate-500">{sizeKb} KB · {file.type || "unknown"}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusColor}`}>{statusLabel}</span>
                          {ex && ex.sensitivityFlags.length > 0 && (
                            <span
                              title={`민감정보 자동 마스킹 적용: ${ex.sensitivityFlags.join(", ")}`}
                              className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800"
                            >
                              ⚠ 민감정보 자동 마스킹: {ex.sensitivityFlags.join(", ")}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeAttachment(idx)}
                            className="ml-auto text-[11px] text-slate-500 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {/* Phase 10.19 — 추천 첨부자료 (구조화된 helper 결과) */}
                  <RecommendedAttachmentsHint
                    startupContextPresent={Boolean(startupContext)}
                    scenarioCategory={scenarioCategory}
                    startupExtras={{
                      applicantType: formData.applicantType,
                      privacyHandling: formData.privacyHandling,
                      ipOutput: formData.ipOutput,
                      workforce: formData.workforce,
                    }}
                  />
                  {/* Phase 10.10 — 보안/민감정보 안내 */}
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                    <p className="font-medium">⚠ 첨부자료 보안 안내</p>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5">
                      <li>주민등록번호, 계좌번호, API Key, 비밀번호, 영업비밀 원문은 필요한 범위만 가리고 첨부해 주세요.</li>
                      <li>현재 데모 단계는 파일명·메타데이터·붙여넣은 핵심 내용 중심으로 분석에 반영됩니다. 본문 자동 파싱은 운영 단계 TODO 입니다.</li>
                      <li>업로드 자료는 법률 리스크 진단 맥락 파악에만 사용되도록 설계됩니다. 첨부 전 사내 승인/비식별 처리를 권장합니다.</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                    토론 참여
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Phase 10.6 — 관찰 모드 제거. 항상 참여 모드로 시작 (라운드 사이 질문 입력 가능) */}
                  <p className="text-sm text-slate-700">
                    토론에 직접 참여합니다. 각 라운드 종료 시 추가 질문을 입력하거나 비서 추천 질문을 사용할 수 있습니다.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-[#1E3A8A]/20 bg-[#1E3A8A]/5">
                <CardHeader>
                  <CardTitle className="text-[#1E3A8A]">입력 가이드 팁</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li>• 진단 목적을 명확히 적으면 에이전트 판단 기준이 선명해집니다.</li>
                    <li>• 상대방(VC/대기업/개인고객) 정보가 전략 제언에 큰 영향을 줍니다.</li>
                    <li>• 핵심 쟁점 문구를 그대로 붙여 넣으면 리스크 진단 정밀도가 높아집니다.</li>
                    <li>• 필수값이 누락되면 다음 단계로 진행되지 않도록 검증됩니다.</li>
                  </ul>
                </CardContent>
              </Card>
            </>
          )}

          {currentStep === 4 && (
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>Step 4. 진단 시작</CardTitle>
                <CardDescription>입력 내용을 확인한 뒤 멀티 에이전트 토론을 요청하세요.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                  <p><strong>카테고리:</strong> {personaCategories.find((c) => c.id === scenarioCategory)?.label}</p>
                  <p><strong>기업명:</strong> {formData.companyName}</p>
                  <p><strong>성장 단계:</strong> {formData.growthStage}</p>
                  <p><strong>산업군:</strong> {formData.industry}</p>
                  <p><strong>진단 목적:</strong> {formData.diagnosticPurpose === "custom" ? formData.customPurpose : formData.diagnosticPurpose}</p>
                  <p><strong>첨부 파일 수:</strong> {attachedFiles.length}개</p>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <p className="text-sm text-amber-900">
                    본 결과는 의사결정 지원용 참고 자료이며, 민감정보 입력은 피해주세요.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={currentStep === 1 ? () => navigate("/") : handlePrevStep}
            >
              {currentStep === 1 ? "취소" : "이전"}
            </Button>

            {currentStep < 4 ? (
              <Button
                type="button"
                disabled={!isStepValid}
                onClick={handleNextStep}
                className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
              >
                다음
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!isStepValid || isSubmitting}
                className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white"
              >
                {isSubmitting ? "요청 중..." : "멀티 에이전트 토론 요청"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

/** Phase 10.3 — 지원사업 컨텍스트 안내 배너 (compact 기본 + 펼치기 + 액션). */
function StartupContextBanner({
  ctx,
  onFillDraft,
  onRevertDraft,
  onClearContext,
  onClearAll,
  canFillDraft,
  draftApplied,
  canRevert,
}: {
  ctx: StartupContext;
  onFillDraft: () => void;
  onRevertDraft: () => void;
  onClearContext: () => void;
  onClearAll: () => void;
  canFillDraft: boolean;
  draftApplied: boolean;
  canRevert: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceLabel =
    ctx.source === "k-startup-service"
      ? "사업공고 조회서비스"
      : ctx.source === "k-startup-news"
        ? "창업소식"
        : ctx.source === "k-startup-mixed"
          ? "통합 매칭"
          : ctx.source ?? "";

  const reviewTags = ["협약 조건", "사업비 정산", "지식재산권 귀속", "환수 조건", "고용 의무", "중복 수혜 제한"];

  return (
    <div
      className="mb-6 rounded-lg border border-[#1E3A8A]/25 bg-[#1E3A8A]/5 px-4 py-3 shadow-sm"
      role="status"
      aria-live="polite"
    >
      {/* compact 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#1E3A8A]">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            지원사업 큐레이션에서 진입
            {sourceLabel && (
              <span className="rounded-full border border-[#1E3A8A]/20 bg-white px-1.5 py-0 text-[10px] text-[#1E3A8A]/80">
                {sourceLabel}
              </span>
            )}
          </div>
          <p className="mt-1.5 break-keep text-sm font-semibold text-slate-900 line-clamp-2">
            {ctx.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {ctx.organization && <>{ctx.organization}</>}
            {ctx.organization && ctx.deadline && <> · </>}
            {ctx.deadline && <>마감 {ctx.deadline}</>}
            {ctx.category && (
              <>
                {" · "}
                <span className="text-slate-500">{ctx.category}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "지원사업 정보 접기" : "지원사업 정보 펼치기"}
          className="rounded-md border border-transparent px-1.5 py-0.5 text-[11px] text-[#1E3A8A] hover:border-[#1E3A8A]/20 hover:bg-white"
        >
          {expanded ? "접기" : "자세히 보기"}
        </button>
      </div>

      {/* 펼친 영역 */}
      {expanded && (
        <div className="mt-3 grid gap-2 rounded-md bg-white/60 px-3 py-2.5 text-xs sm:grid-cols-2">
          {ctx.target && (
            <div className="break-keep">
              <span className="text-slate-500">지원 대상: </span>
              <span className="text-slate-700">{ctx.target}</span>
            </div>
          )}
          {ctx.fieldSummary && (
            <div className="break-keep sm:col-span-2">
              <span className="text-slate-500">지원 분야 / 요약: </span>
              <span className="text-slate-700 line-clamp-3">{ctx.fieldSummary}</span>
            </div>
          )}
          {ctx.aiInsightHint && (
            <div className="break-keep sm:col-span-2">
              <span className="text-slate-500">AI 추천 보조 분석: </span>
              <span className="text-slate-700">{ctx.aiInsightHint}</span>
            </div>
          )}
        </div>
      )}

      {/* 검토 태그 */}
      <div className="mt-3">
        <p className="mb-1 text-[11px] font-medium text-slate-600">검토 필요 가능성</p>
        <div className="flex flex-wrap gap-1">
          {reviewTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-900"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        공고문/협약서/계약서를 본 입력란에 붙여넣거나 첨부하시면 더 정확한 진단이 가능합니다.
      </p>

      {/* Phase 10.7 — 액션 영역: 적용 상태에 따라 버튼 라벨/구성 분기 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#1E3A8A]/10 pt-2.5">
        {draftApplied ? (
          <>
            <span
              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"
              aria-live="polite"
            >
              <FileText className="h-3.5 w-3.5" />
              지원사업 초안 적용됨
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onFillDraft}
              className="border-[#1E3A8A]/40 text-[#1E3A8A] hover:bg-[#1E3A8A]/10"
              aria-label="초안 다시 만들기 (빈 항목만 채워짐)"
            >
              초안 다시 만들기
            </Button>
            {canRevert && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRevertDraft}
                className="border-slate-300 text-slate-600 hover:bg-slate-50"
                aria-label="자동 입력을 되돌리기"
              >
                자동 입력 되돌리기
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onFillDraft}
            disabled={!canFillDraft}
            className="border-[#1E3A8A]/40 text-[#1E3A8A] hover:bg-[#1E3A8A]/10 disabled:opacity-50"
            aria-label="지원사업 정보로 진단 입력 초안 자동 채우기"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            지원사업 정보로 입력 초안 만들기
          </Button>
        )}
        {ctx.applyUrl && (
          <a
            href={ctx.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#1E3A8A] hover:underline"
            aria-label="원본 공고 페이지 새 탭에서 열기"
          >
            원본 공고 보기 <ArrowRight className="h-3 w-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClearContext}
            className="text-[11px] text-slate-500 hover:text-slate-700 hover:underline"
            aria-label="지원사업 정보만 초기화 (자동 입력 값은 유지)"
          >
            지원사업 정보만 초기화
          </button>
          {draftApplied && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] text-slate-500 hover:text-slate-700 hover:underline"
              aria-label="지원사업 정보 및 자동 입력값 모두 초기화"
            >
              모두 초기화
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        ⚠ 공고문/협약서/사업계획서에 영업비밀·개인정보가 포함될 수 있습니다.
        본 입력란 또는 첨부 영역에는 민감정보를 가린 뒤 제공해 주세요.
      </p>
    </div>
  );
}

/** Phase 10.19 — 추천 첨부자료 (구조화된 helper 결과 사용, sensitivity/optional 표시). */
function RecommendedAttachmentsHint({
  startupContextPresent,
  scenarioCategory,
  startupExtras,
}: {
  startupContextPresent: boolean;
  scenarioCategory: string;
  startupExtras?: Record<string, unknown>;
}) {
  const items = recommendedAttachmentsFor({
    startupContextPresent,
    scenarioCategory,
    startupExtras,
    reviewType: scenarioCategory,
  });

  const sensitivityBadge = (s: "low" | "medium" | "high") => {
    if (s === "high") return { label: "민감도 ↑", cls: "border-red-200 bg-red-50 text-red-700" };
    if (s === "medium") return { label: "민감도 중", cls: "border-amber-200 bg-amber-50 text-amber-800" };
    return { label: "민감도 ↓", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  };

  return (
    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2">
      <p className="mb-1.5 text-xs font-semibold text-sky-900">📎 비서 추천 첨부자료 (선택)</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => {
          const sb = sensitivityBadge(it.sensitivity);
          return (
            <span
              key={it.key}
              title={`${it.reason}${it.optional ? " (옵션)" : " (권장)"}`}
              className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] text-sky-800"
            >
              <span className="font-medium">{it.label}</span>
              <span className="text-[10px] text-slate-500">— {it.reason}</span>
              <span className={`rounded border px-1 py-0 text-[9px] ${sb.cls}`}>{sb.label}</span>
              {!it.optional && (
                <span className="rounded border border-sky-200 bg-sky-100 px-1 py-0 text-[9px] text-sky-700">권장</span>
              )}
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10.5px] text-slate-500">
        첨부하지 않아도 진단은 진행되지만, 추가 자료가 있을수록 검토 정확도가 향상됩니다. 민감도 ↑ 자료는 사내 승인/비식별 처리 후 업로드를 권장합니다.
      </p>
    </div>
  );
}
