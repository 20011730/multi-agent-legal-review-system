import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Scale, ArrowLeft, ArrowRight, Building2, FileText, AlertCircle, Eye, MessageSquare } from "lucide-react";

export function InputPage() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    companyName: "",
    industry: "",
    reviewType: "",
    situation: "",
    content: "",
    participationMode: "observe", // "observe" or "participate"
  });

  useEffect(() => {
    // Check if user is logged in
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (!userStr) {
      navigate("/login");
      return;
    }

    // Load company profile from backend
    const user = JSON.parse(userStr);
    fetch(`http://localhost:8080/api/users/${user.id}/profile`)
      .then((res) => res.ok ? res.json() : null)
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

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    sessionStorage.setItem("reviewData", JSON.stringify(formData));

    try {
      const user = JSON.parse(localStorage.getItem("legalreview_currentUser") || "{}");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user.id) {
        headers["X-User-Id"] = String(user.id);
      }

      const res = await fetch("http://localhost:8080/api/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      sessionStorage.setItem("sessionId", String(data.sessionId));
    } catch (err) {
      console.error("세션 생성 실패:", err);
    }

    setIsSubmitting(false);
    navigate("/result");
  };

  const isFormValid = 
    formData.companyName && 
    formData.industry && 
    formData.reviewType && 
    formData.situation && 
    formData.content &&
    formData.participationMode;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dbeafe_0%,_#f8fafc_45%,_#f8fafc_100%)]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 hover:opacity-70 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="font-semibold text-slate-900">LexRex AI</h1>
              <p className="text-xs text-slate-500">Multi-Agent Legal Compliance System</p>
            </div>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            뒤로 가기
          </button>
          <h2 className="text-3xl font-semibold text-slate-900 tracking-tight mb-2">검토 정보 입력</h2>
          <p className="text-slate-600">검토가 필요한 문서 또는 의사결정 내용을 입력해주세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="border-slate-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <CardTitle>기업 정보</CardTitle>
              </div>
              <CardDescription>
                검토 대상 기업 또는 조직의 기본 정보를 입력합니다
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyName">기업명 *</Label>
                <Input
                  id="companyName"
                  placeholder="예: (주)테크이노베이션"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="bg-white h-11 rounded-xl"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="industry">산업 분야 *</Label>
                  <Select
                    value={formData.industry}
                    onValueChange={(value) => setFormData({ ...formData, industry: value })}
                  >
                    <SelectTrigger id="industry" className="bg-white h-11 rounded-xl">
                      <SelectValue placeholder="선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tech">IT·소프트웨어</SelectItem>
                      <SelectItem value="finance">금융·보험</SelectItem>
                      <SelectItem value="manufacturing">제조·생산</SelectItem>
                      <SelectItem value="retail">유통·리테일</SelectItem>
                      <SelectItem value="healthcare">의료·헬스케어</SelectItem>
                      <SelectItem value="education">교육·연구</SelectItem>
                      <SelectItem value="media">미디어·엔터테인먼트</SelectItem>
                      <SelectItem value="other">기타</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reviewType">검토 유형 *</Label>
                  <Select
                    value={formData.reviewType}
                    onValueChange={(value) => setFormData({ ...formData, reviewType: value })}
                  >
                    <SelectTrigger id="reviewType" className="bg-white h-11 rounded-xl">
                      <SelectValue placeholder="선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="marketing">마케팅·광고 문구</SelectItem>
                      <SelectItem value="press">보도자료·공시</SelectItem>
                      <SelectItem value="contract">계약서·약관</SelectItem>
                      <SelectItem value="policy">사내 규정·정책</SelectItem>
                      <SelectItem value="communication">대외 커뮤니케이션</SelectItem>
                      <SelectItem value="decision">경영 의사결정</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <CardTitle>검토 내용</CardTitle>
              </div>
              <CardDescription>
                검토가 필요한 상황과 원문을 구체적으로 작성해주세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="situation">상황 설명 *</Label>
                <Textarea
                  id="situation"
                  placeholder="예: 신제품 출시 관련 마케팅 캠페인을 준비 중입니다. 타겟 고객은 20-30대이며, SNS를 통해 바이럴 마케팅을 진행할 예정입니다. 경쟁사 제품과의 비교 우위를 강조하고자 합니다."
                  value={formData.situation}
                  onChange={(e) => setFormData({ ...formData, situation: e.target.value })}
                  className="min-h-[120px] bg-white rounded-xl"
                />
                <p className="text-xs text-gray-500">
                  배경, 목적, 대상 독자, 예상 영향 등을 포함하여 작성해주세요
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">검토 원문 *</Label>
                <Textarea
                  id="content"
                  placeholder="예: '업계 1위 제품보다 2배 빠른 성능! 타사 제품은 이제 구시대 유물입니다. 지금 구매하시면 특별 할인 50% + 추가 사은품 증정! 한정 수량이므로 서둘러 주문하세요. 이 기회를 놓치면 후회합니다!'"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="min-h-[200px] bg-white rounded-xl font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  검토가 필요한 문서, 문구, 정책 내용을 정확히 입력해주세요
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                <CardTitle>토의 참여 방식</CardTitle>
              </div>
              <CardDescription>
                에이전트 토의 과정에서 본인의 참여 방식을 선택해주세요
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={formData.participationMode}
                onValueChange={(value) => setFormData({ ...formData, participationMode: value })}
                className="space-y-4"
              >
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="observe" id="observe" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="observe" className="flex items-center gap-2 cursor-pointer">
                      <Eye className="w-4 h-4 text-gray-600" />
                      <span className="font-medium">관찰 모드 (추천)</span>
                    </Label>
                    <p className="text-sm text-gray-600 mt-1 ml-6">
                      에이전트들이 자동으로 3라운드 토의를 진행합니다. 
                      각 라운드에서 3명의 에이전트가 순차적으로 분석하고, 
                      다른 에이전트의 의견을 참고하여 종합적인 검토를 수행합니다.
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="participate" id="participate" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="participate" className="flex items-center gap-2 cursor-pointer">
                      <MessageSquare className="w-4 h-4 text-gray-600" />
                      <span className="font-medium">참여 모드</span>
                    </Label>
                    <p className="text-sm text-gray-600 mt-1 ml-6">
                      각 라운드 종료 후 본인의 의견을 추가할 수 있습니다. 
                      질문하거나 반박하면 에이전트들이 이를 반영하여 다음 라운드를 진행합니다. 
                      더 상호작용적인 검토를 원하신다면 이 모드를 선택하세요.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-medium mb-1">검토 전 유의사항</p>
              <ul className="list-disc list-inside space-y-1 text-amber-800">
                <li>본 시스템은 참고용 분석 도구이며, 실제 법률 자문을 대체하지 않습니다</li>
                <li>민감한 개인정보나 기밀 정보는 입력하지 마세요</li>
                <li>최종 의사결정은 법무팀 및 전문가의 검토를 거쳐 진행해주세요</li>
              </ul>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/')}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={!isFormValid}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            >
              검토 시작
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}