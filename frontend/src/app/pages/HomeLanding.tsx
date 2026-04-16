import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Activity, ArrowRight, Landmark, Scale, ShieldCheck } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Button } from "../components/ui/button";

const trustHighlights = [
  "법령 데이터 동기화 상태: 정상",
  "멀티 에이전트 교차검증 진행 중",
  "근거 출처 추적(Source Attribution) 활성화",
];

export function HomeLanding() {
  const navigate = useNavigate();
  const userStr = localStorage.getItem("legalreview_currentUser");
  const isLoggedIn = Boolean(userStr);
  const [isIntroVisible, setIsIntroVisible] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsIntroVisible(true);
    }, 90);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setHighlightIndex((prev) => (prev + 1) % trustHighlights.length);
    }, 2600);
    return () => window.clearInterval(ticker);
  }, []);

  return (
    <MarketingLayout>
      <section className="relative min-h-[72vh] flex items-center justify-center overflow-hidden">
        <div className="relative text-center max-w-5xl mx-auto">
          <p
            className={`text-center text-[22px] md:text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-slate-600 mb-8 whitespace-nowrap transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 blur-0 translate-y-0" : "opacity-0 blur-[6px] translate-y-2"
            }`}
          >
            혁신 성장의 법률적 토대, LexRex AI가 함께합니다.
          </p>
          <h2
            className={`font-menu text-center text-7xl md:text-9xl font-bold tracking-[-0.03em] leading-[1.02] mb-9 text-[#1E3A8A] transition-all duration-[1500ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 blur-0 translate-y-0" : "opacity-0 blur-[7px] translate-y-2"
            }`}
          >
            LexRex AI
          </h2>
          <p
            className={`text-center text-[15px] md:text-[18px] text-slate-500 max-w-none mx-auto mb-11 leading-[1.55] transition-all duration-[1000ms] delay-100 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 blur-0 translate-y-0" : "opacity-0 blur-[6px] translate-y-2"
            }`}
          >
            <span className="block whitespace-nowrap">신기술·신산업 현장에서 발생하는 복잡한 법률 이슈, 이제 비용 걱정 없이 AI 어시스턴트로 해결하세요.</span>
            <span className="block mt-1.5 whitespace-nowrap">투자 계약부터 지식재산권 보호까지, 성장의 단계에서 신뢰할 수 있는 가이드를 제시합니다.</span>
          </p>

          <div
            className={`mx-auto mb-8 w-fit rounded-full border border-[#1E3A8A]/20 bg-white/85 px-5 py-2 backdrop-blur-md transition-all duration-[1100ms] delay-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
            }`}
          >
            <div className="flex items-center gap-2 text-[13px] md:text-[14px] text-slate-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <Activity className="w-4 h-4 text-[#1E3A8A]" />
              <span key={highlightIndex} className="font-medium tracking-[-0.01em]">
                {trustHighlights[highlightIndex]}
              </span>
            </div>
          </div>

          <div
            className={`flex items-center justify-center transition-all duration-[1300ms] delay-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 blur-0 translate-y-0" : "opacity-0 blur-[5px] translate-y-2"
            }`}
          >
            <Button size="lg" className="h-12 min-w-[248px] rounded-full px-7 text-[15px] tracking-[-0.01em]" onClick={() => navigate(isLoggedIn ? "/input" : "/login")}>
              법률 리스크 진단하기
              <ArrowRight className="w-5 h-5 ml-2 text-current" />
            </Button>
          </div>

          <div
            className={`mt-9 grid grid-cols-1 md:grid-cols-3 gap-3 transition-all duration-[1300ms] delay-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
            }`}
          >
            <div className="rounded-xl border border-[#CBD5E1] bg-white/85 px-4 py-3 backdrop-blur-sm text-left">
              <div className="flex items-center gap-2 mb-1">
                <Scale className="w-4 h-4 text-[#1E3A8A]" />
                <p className="text-[13px] font-semibold text-slate-800">법무 검증</p>
              </div>
              <p className="text-[12px] text-slate-600">법령·판례 근거 기반 리스크 진단</p>
            </div>
            <div className="rounded-xl border border-[#CBD5E1] bg-white/85 px-4 py-3 backdrop-blur-sm text-left">
              <div className="flex items-center gap-2 mb-1">
                <Landmark className="w-4 h-4 text-[#1E3A8A]" />
                <p className="text-[13px] font-semibold text-slate-800">멀티 에이전트 합의</p>
              </div>
              <p className="text-[12px] text-slate-600">관점 충돌을 중재해 최종 권고안 도출</p>
            </div>
            <div className="rounded-xl border border-[#CBD5E1] bg-white/85 px-4 py-3 backdrop-blur-sm text-left">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-[#1E3A8A]" />
                <p className="text-[13px] font-semibold text-slate-800">신뢰·보안</p>
              </div>
              <p className="text-[12px] text-slate-600">데이터 보호 원칙과 출처 추적으로 투명성 확보</p>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

