import React from "react";
import { CheckCircle2 } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";

export function ServiceTrust() {
  return (
    <MarketingLayout
      title="신뢰와 보안"
      description="법령 업데이트 체계, 정확도 검증, 데이터 보호 원칙을 명확히 공개해 신뢰 가능한 AI 법률 파트너를 지향합니다."
    >
      <div className="grid lg:grid-cols-2 gap-5 items-stretch">
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-6 space-y-4">
            <h4 className="font-semibold">법령 업데이트 및 동기화</h4>
            <div className="space-y-3 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium mb-1">실시간 데이터 동기화</p>
                <p>국가법령정보센터 API 연동으로 최신 공포 법령/판례 데이터를 주기적으로 동기화합니다.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium mb-1">주기적 해석 업데이트</p>
                <p>신규 해석례와 가이드라인은 스케줄링 작업으로 RAG 데이터베이스에 반영됩니다.</p>
              </div>
            </div>
            <h4 className="font-semibold pt-1">정확도 보장 체계</h4>
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />Cross-Validation으로 에이전트 간 응답을 상호 검증</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />근거 추출(Source Attribution)로 조항/판례 출처를 명시</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-6">
            <h4 className="font-semibold mb-4">Trust FAQ</h4>
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">Q. 기업 정보는 안전하게 처리되나요?</p>
                <p className="text-slate-700 mt-1">A. 세션 데이터는 저장 시 암호화하며, 요청 시 즉시 파기할 수 있는 Zero-Retention 정책을 따릅니다.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">Q. 사용자 입력이 모델 학습에 사용되나요?</p>
                <p className="text-slate-700 mt-1">A. 사용자의 입력 데이터는 외부 LLM 재학습 데이터로 사용하지 않습니다.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">Q. 결과를 어떻게 신뢰할 수 있나요?</p>
                <p className="text-slate-700 mt-1">A. 멀티 에이전트 상호 검증과 근거 출처 공개로 결과 생성 과정을 투명하게 제공합니다.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}

