import React from "react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";

export function ServiceTechnology() {
  return (
    <MarketingLayout
      title="핵심 기술"
      description="Spring Boot & FastAPI 기반 분산 처리와 멀티 에이전트 토론 로직으로 결과의 신뢰도와 확장성을 확보합니다."
    >
      <div className="grid lg:grid-cols-2 gap-5 items-stretch">
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-6">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500 mb-3">Mediation Logic</p>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold mb-1">1) 독립 페르소나 분석</p>
                <p>각 에이전트는 독립된 프롬프트 페르소나로 같은 입력을 다른 관점에서 해석합니다.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold mb-1">2) 합의 알고리즘</p>
                <p>불일치 발생 시 판정 에이전트가 법적 근거와 실행 가능성을 가중치 기반으로 중재합니다.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold mb-1">3) 소수 의견 병기</p>
                <p>합의되지 않은 유의미한 반론은 Minority Opinion으로 리포트 하단에 병기합니다.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-6">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500 mb-3">System Architecture</p>
            <div className="rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] p-5">
              <div className="grid grid-cols-1 gap-3 text-sm">
                <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                  <p className="font-semibold text-[#1E3A8A]">Frontend Client</p>
                  <p className="text-slate-600">입력, 실시간 토론 관찰, 결과 리포트 확인 UI</p>
                </div>
                <div className="text-center text-slate-400">↓</div>
                <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                  <p className="font-semibold text-[#1E3A8A]">Spring Boot</p>
                  <p className="text-slate-600">인증, 세션 오케스트레이션, 작업 상태 관리</p>
                </div>
                <div className="text-center text-slate-400">↓</div>
                <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                  <p className="font-semibold text-[#1E3A8A]">FastAPI + RAG</p>
                  <p className="text-slate-600">근거 검색(RAG), 멀티 에이전트 추론, 최종 합의 도출</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}

