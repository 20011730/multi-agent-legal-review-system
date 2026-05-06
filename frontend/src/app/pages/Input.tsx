import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AlertCircle, ArrowLeft, ArrowRight, Building2, Eye, FileText, FolderOpen, MessageSquare, Sparkles, Upload } from "lucide-react";

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

export function InputPage() {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scenarioCategory, setScenarioCategory] = useState("contract");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const [formData, setFormData] = useState({
    companyName: "",
    growthStage: "",
    industry: "",
    diagnosticPurpose: "",
    customPurpose: "",
    counterpartyInfo: "",
    reviewType: "contract",
    situation: "",
    content: "",
    participationMode: "observe",
  });

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

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachedFiles((prev) => [...prev, ...files].slice(0, 5));
    event.target.value = "";
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
      return Boolean(formData.situation && formData.content && formData.participationMode);
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
    setIsSubmitting(true);

    const payloadForSession = {
      companyName: formData.companyName,
      industry: formData.industry,
      reviewType: scenarioCategory,
      situation: formData.situation,
      content: formData.content,
      participationMode: formData.participationMode,
    };

    sessionStorage.setItem(
      "reviewData",
      JSON.stringify({
        ...formData,
        scenarioCategory,
        attachedFileNames: attachedFiles.map((file) => file.name),
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
                        <SelectItem value="toxic-terms">계약서 독소조항 탐지</SelectItem>
                        <SelectItem value="compliance-check">규제 준수 여부 확인</SelectItem>
                        <SelectItem value="dispute-response">분쟁 대응 시나리오</SelectItem>
                        <SelectItem value="risk-screening">사전 리스크 스크리닝</SelectItem>
                        <SelectItem value="custom">직접 입력</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="counterpartyInfo">상대방 정보</Label>
                    <Input
                      id="counterpartyInfo"
                      value={formData.counterpartyInfo}
                      onChange={(e) => setFormData({ ...formData, counterpartyInfo: e.target.value })}
                      placeholder="예: VC, 대기업, 개인 고객"
                    />
                  </div>
                </div>
                {formData.diagnosticPurpose === "custom" && (
                  <div className="space-y-2">
                    <Label htmlFor="customPurpose">진단 목적 상세 입력 *</Label>
                    <Input
                      id="customPurpose"
                      value={formData.customPurpose}
                      onChange={(e) => setFormData({ ...formData, customPurpose: e.target.value })}
                      placeholder="원하는 진단 목적을 직접 입력하세요"
                    />
                  </div>
                )}
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
                  <div className="space-y-2">
                    <Label htmlFor="situation">상황 설명 *</Label>
                    <Textarea
                      id="situation"
                      value={formData.situation}
                      onChange={(e) => setFormData({ ...formData, situation: e.target.value })}
                      className="min-h-[120px]"
                      placeholder="현재 상황, 배경, 쟁점, 우려사항을 구체적으로 적어주세요."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="content">검토 원문/문구 *</Label>
                    <Textarea
                      id="content"
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className="min-h-[180px]"
                      placeholder="계약 조항, 공지 문구, 대외 문서의 핵심 내용을 입력하세요."
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
                  <CardDescription>계약서(PDF), 공문, 협약서 등 (데모 단계에서는 파일명만 저장)</CardDescription>
                </CardHeader>
                <CardContent>
                  <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                    <Upload className="w-6 h-6 mx-auto text-slate-500 mb-2" />
                    <p className="text-sm text-slate-700">파일 선택 또는 드래그</p>
                    <input type="file" className="hidden" multiple onChange={handleFileChange} />
                  </label>
                  <div className="mt-3 space-y-2">
                    {attachedFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="flex items-center gap-2 text-sm text-slate-700">
                        <FolderOpen className="w-4 h-4" /> {file.name}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-[#1E3A8A]" />
                    토론 참여 모드
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    value={formData.participationMode}
                    onValueChange={(value) => setFormData({ ...formData, participationMode: value })}
                    className="space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="observe" id="observe" />
                      <Label htmlFor="observe" className="cursor-pointer">
                        <Eye className="inline w-4 h-4 mr-1" />
                        관찰 모드
                      </Label>
                    </div>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="participate" id="participate" />
                      <Label htmlFor="participate" className="cursor-pointer">
                        <MessageSquare className="inline w-4 h-4 mr-1" />
                        참여 모드
                      </Label>
                    </div>
                  </RadioGroup>
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
