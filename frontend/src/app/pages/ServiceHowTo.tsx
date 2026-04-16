import React from "react";
import { BriefcaseBusiness, ClipboardList, FileCheck, RotateCcw } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";

export function ServiceHowTo() {
  return (
    <MarketingLayout
      title="이용방법"
      description="입력부터 재검토까지, 사용자 경험 중심의 4단계 프로세스로 법률 리스크 분석을 진행합니다."
    >
      <div className="grid md:grid-cols-2 gap-5 items-stretch">
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-6 pb-6 flex flex-col">
            <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
              <ClipboardList className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">01</p>
            <h4 className="font-semibold mb-2">입력</h4>
            <p className="text-sm text-slate-600">검토 대상 문구, 상황, 계약 맥락을 입력하고 자료를 첨부합니다.</p>
          </CardContent>
        </Card>
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-6 pb-6 flex flex-col">
            <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
              <BriefcaseBusiness className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">02</p>
            <h4 className="font-semibold mb-2">실시간 토론 관찰</h4>
            <p className="text-sm text-slate-600">법무·사업·윤리 에이전트의 토론 상태와 논의 흐름을 확인합니다.</p>
          </CardContent>
        </Card>
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-6 pb-6 flex flex-col">
            <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
              <FileCheck className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">03</p>
            <h4 className="font-semibold mb-2">리포트 확인</h4>
            <p className="text-sm text-slate-600">리스크 점수, 에이전트별 제언, 근거가 포함된 최종 결과를 받습니다.</p>
          </CardContent>
        </Card>
        <Card className="h-full border-slate-200 bg-white">
          <CardContent className="h-full pt-6 pb-6 flex flex-col">
            <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
              <RotateCcw className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
            </div>
            <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">04</p>
            <h4 className="font-semibold mb-2">재검토</h4>
            <p className="text-sm text-slate-600">질문을 추가하거나 조건을 바꿔 다시 토론시키며 결론을 정교화합니다.</p>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}

