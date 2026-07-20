import React from "react";
import { BriefcaseBusiness, FileCheck, Scale } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";

export function ServiceAbout() {
  return (
    <MarketingLayout
      title="서비스 소개"
      description="LexRex AI는 단일 응답형 AI가 아닌 멀티 에이전트 협업 모델을 통해 더 신뢰도 높은 법률 의사결정을 지원합니다."
    >
      <div className="grid md:grid-cols-3 gap-5 items-stretch">
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-5 pb-5 flex flex-col">
            <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
              <Scale className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <h4 className="font-semibold mb-2">왜 토론 시스템인가?</h4>
            <p className="text-sm text-slate-600 break-keep">
              단일 모델의 관점 편향을 줄이기 위해, 법무·사업·윤리 에이전트가 동일 사안을 서로 다른 논리로 검토합니다.
            </p>
          </CardContent>
        </Card>
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-5 pb-5 flex flex-col">
            <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
              <BriefcaseBusiness className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <h4 className="font-semibold mb-2">의사결정 비용 절감</h4>
            <p className="text-sm text-slate-600 break-keep">
              초기 스타트업이 반복적으로 겪는 법률 검토 이슈를 빠르게 점검해 시간과 자문 비용 부담을 줄입니다.
            </p>
          </CardContent>
        </Card>
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-5 pb-5 flex flex-col">
            <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
              <FileCheck className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <h4 className="font-semibold mb-2">리스크 방어 강화</h4>
            <p className="text-sm text-slate-600 break-keep">
              핵심 리스크와 수정 권고안을 함께 제시해, 실행 전 사전 방어 전략을 수립할 수 있도록 지원합니다.
            </p>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}

