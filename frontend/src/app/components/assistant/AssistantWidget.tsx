/**
 * AssistantWidget — 전역 floating button 비서 위젯 (Phase 1 정적 안내 only).
 *
 * 정책:
 *   - LLM 호출 없음 — 정적 FAQ 매핑
 *   - 토론 시스템 (BIZ/LEGAL/JUDGE) 과 분리 — 사용자 보조 역할만
 *   - Phase 2 에서 backend /api/assistant/chat 으로 확장 예정
 *
 * 사용 위치: App.tsx 에서 한 번만 mount 하여 모든 페이지에서 floating button 표시.
 */
import { useState } from "react";
import { Bot, MessageCircleQuestion, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: "내 상황에 맞는 지원사업을 어떻게 찾나요?",
    answer:
      "`/startup-support` 에서 카테고리(사업화/정책자금/R&D/멘토링/창업교육/법률·세무·노무/투자·IR)와 지역, 모집 상태로 필터링하세요. 상단의 '마감 임박' 섹션을 먼저 확인하면 놓치지 말아야 할 사업을 빠르게 추릴 수 있습니다.",
  },
  {
    question: "법률 검토와 창업지원 정보는 어떻게 연결되나요?",
    answer:
      "법률 검토(`/input` → `/result` → `/verdict`)로 계약·광고·규제 리스크를 점검한 뒤, `/startup-support` 의 '법률·세무·노무' 카테고리에서 무료 상담·표준계약서 검토 지원을 활용해 의견을 보강할 수 있습니다. Phase 2 에서는 검토 결과 키워드를 기반으로 지원사업이 자동 추천될 예정입니다.",
  },
  {
    question: "IR/투자 계약 전에 어떤 법률 검토가 필요하나요?",
    answer:
      "투자 계약서(투자 라운드 SAFE/SHA), 우선주 조건, 동반매도권/지분희석, 이사회 권한 항목을 우선 검토하세요. 본 서비스의 멀티 에이전트 토론으로 1차 점검 후, '법률·세무·노무 1:1 무료상담' 으로 변호사 의견을 보강하는 흐름을 권장합니다.",
  },
  {
    question: "지원사업 신청 전에 준비할 문서는 무엇인가요?",
    answer:
      "공통 필수: 사업계획서, 대표/팀 이력, 매출/재무 현황(있다면), 핵심 기술/제품 자료, IR 덱. 정책자금은 신용·세무 자료가 추가로 필요하고, R&D 사업은 기술 차별성/특허 자료가 중요합니다. 각 카드의 '신청 페이지 열기' 에서 기관 공식 요건을 확인하세요.",
  },
  {
    question: "나중에 비즈니스 전문가 에이전트와 어떻게 연결되나요?",
    answer:
      "Phase 2 에서 비즈니스 에이전트(K-Startup·공공데이터 기반)와 본 위젯이 연동되어, 사용자의 분야·단계·지역을 기억한 맞춤 큐레이션 + 후속 질의응답이 가능해질 예정입니다. 현재는 정적 안내만 제공하며, 토론 라운드(BIZ/LEGAL/JUDGE)에는 끼어들지 않습니다.",
  },
];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      {/* floating button */}
      <button
        type="button"
        aria-label="AI 비서 열기"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#1E3A8A] text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {/* panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-40 flex max-h-[70vh] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          role="dialog"
          aria-label="AI 비서 안내"
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-[#1E3A8A] px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              <span className="text-sm font-semibold">LexRex 비서</span>
              <Badge variant="outline" className="border-white/40 bg-white/10 text-[10px] text-white">
                Phase 1
              </Badge>
            </div>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* body */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-3 text-xs leading-relaxed text-slate-600">
              아직 LLM 기반 대화는 제공하지 않습니다. 자주 묻는 질문 중 하나를 선택해 안내를 확인하세요.
            </p>
            <ul className="space-y-1">
              {FAQS.map((faq, idx) => (
                <li key={faq.question}>
                  <button
                    type="button"
                    onClick={() => setActive(active === idx ? null : idx)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      active === idx
                        ? "border-[#1E3A8A]/40 bg-[#1E3A8A]/5 text-[#1E3A8A]"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <MessageCircleQuestion className="h-3.5 w-3.5" />
                      <span className="line-clamp-1">{faq.question}</span>
                    </span>
                  </button>
                  {active === idx && (
                    <p className="mt-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                      {faq.answer}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* footer */}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
            추후 LLM 기반 대화로 확장 예정 (Phase 2)
          </div>
        </div>
      )}
    </>
  );
}
