import React from "react";
import {
  BadgeDollarSign,
  Building2,
  ClipboardList,
  Landmark,
  RotateCcw,
  Scale,
  Shield,
  UserRound,
} from "lucide-react";
import { MarketingLayout } from "../components/MarketingLayout";
import { Card, CardContent } from "../components/ui/card";

const domains = [
  { icon: Scale, title: "계약·거래", desc: "비즈니스 파트너와의 계약, 물품공급계약 등" },
  { icon: Landmark, title: "지식재산·브랜드", desc: "지식재산권을 보호하기 위한 법률적 대응" },
  { icon: Shield, title: "개인정보·데이터", desc: "개인정보 처리 및 보호에 대한 법률 자문" },
  { icon: ClipboardList, title: "규제·인허가 대응", desc: "인허가 획득 및 신산업 법규제 준수 가이드" },
  { icon: UserRound, title: "인사·노무", desc: "노동갈등이나 인사노무 관련 분야의 지원" },
  { icon: BadgeDollarSign, title: "투자·자금조달", desc: "투자 계약 및 라운드 협의 관련 법률적 지원" },
  { icon: Building2, title: "기업운영·법무", desc: "기업 경영에 필요한 기본적 법률 검토 사항" },
  { icon: RotateCcw, title: "사업정리·재도전", desc: "폐업청산, 철수, 회생파산, 재창업 관련 법률지원" },
];

export function ServiceDomains() {
  return (
    <MarketingLayout
      title="전문분야"
      description="스타트업 운영 전반에서 빈번하게 발생하는 8대 법률 카테고리를 중심으로 리스크를 진단합니다."
    >
      <Card className="border-slate-200 bg-white">
        <CardContent className="p-4 md:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[10px] items-stretch">
            {domains.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <Icon className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[15px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">{item.title}</p>
                  <p className="text-[11px] leading-[1.2] tracking-[-0.022em] text-[#64748B]">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </MarketingLayout>
  );
}

