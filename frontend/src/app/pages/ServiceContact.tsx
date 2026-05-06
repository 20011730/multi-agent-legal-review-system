import React from "react";
import { Mail, Phone } from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";

export function ServiceContact() {
  return (
    <MarketingLayout
      title="문의하기"
      description="도입 문의, 엔터프라이즈 협업, 기술 지원 및 피드백 접수를 위한 채널입니다."
    >
      <Card className="border-slate-200 bg-white">
        <CardContent className="p-7 md:p-8">
          <h3 className="text-[30px] leading-[1.15] font-semibold tracking-tight mb-3">도입 문의 및 기술 지원</h3>
          <p className="text-slate-600 mb-6">
            엔터프라이즈 도입 상담이 필요하거나 서비스 개선 의견이 있다면 아래 정보를 남겨주세요.
          </p>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <input className="h-11 rounded-xl border border-[#64748B]/35 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]" placeholder="이름 / 회사명" />
            <input className="h-11 rounded-xl border border-[#64748B]/35 bg-white px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]" placeholder="이메일 / 연락처" />
            <textarea className="md:col-span-2 min-h-[110px] rounded-xl border border-[#64748B]/35 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20 focus:border-[#1E3A8A]" placeholder="문의 내용을 입력해주세요." />
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-slate-700">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-slate-500" /> legalreview@demo.ai</div>
              <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-slate-500" /> 02-1234-5678</div>
            </div>
            <Button className="rounded-full px-6">문의 보내기</Button>
          </div>
        </CardContent>
      </Card>
    </MarketingLayout>
  );
}

