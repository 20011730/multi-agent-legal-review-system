import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import { Scale, Building2, CheckCircle, LogOut, FileText, AlertCircle } from "lucide-react";

interface CompanyProfile {
  // Basic info
  companyName: string;
  industry: string;
  companySize: string;
  website: string;
  description: string;
  
  // Review type specific fields
  reviewTypes: string[];
  
  // Marketing/Advertising
  mainProducts?: string;
  targetMarket?: string;
  competitorInfo?: string;
  
  // Contract/Policy
  standardContracts?: string;
  keyPartners?: string;
  regulatoryRequirements?: string;
  
  // Press Release/Communication
  irContact?: string;
  prHistory?: string;
  stakeholders?: string;
}

const reviewTypeFields = {
  marketing: {
    label: "마케팅·광고",
    fields: ["mainProducts", "targetMarket", "competitorInfo"],
  },
  press: {
    label: "보도자료·공시",
    fields: ["irContact", "prHistory", "stakeholders"],
  },
  contract: {
    label: "계약서·약관",
    fields: ["standardContracts", "keyPartners", "regulatoryRequirements"],
  },
  policy: {
    label: "사내 규정·정책",
    fields: ["companySize", "regulatoryRequirements"],
  },
  communication: {
    label: "대외 커뮤니케이션",
    fields: ["stakeholders", "prHistory"],
  },
  decision: {
    label: "경영 의사결정",
    fields: ["keyPartners", "regulatoryRequirements"],
  },
};

export function CompanyProfile() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<CompanyProfile>({
    companyName: "",
    industry: "",
    companySize: "",
    website: "",
    description: "",
    reviewTypes: [],
  });
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    // Check if user is logged in
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (!userStr) {
      navigate("/login");
      return;
    }

    const user = JSON.parse(userStr);
    setCurrentUser(user);

    // Load existing profile
    const profileStr = localStorage.getItem(`legalreview_profile_${user.id}`);
    if (profileStr) {
      setProfile(JSON.parse(profileStr));
    } else {
      // Initialize with user's company name
      setProfile((prev) => ({ ...prev, companyName: user.companyName }));
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem("legalreview_currentUser");
    navigate("/");
  };

  const handleReviewTypeToggle = (type: string) => {
    setProfile((prev) => ({
      ...prev,
      reviewTypes: prev.reviewTypes.includes(type)
        ? prev.reviewTypes.filter((t) => t !== type)
        : [...prev.reviewTypes, type],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) return;

    // Save profile
    localStorage.setItem(`legalreview_profile_${currentUser.id}`, JSON.stringify(profile));

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const getRelevantFields = () => {
    const fields = new Set<string>();
    profile.reviewTypes.forEach((type) => {
      const typeConfig = reviewTypeFields[type as keyof typeof reviewTypeFields];
      if (typeConfig) {
        typeConfig.fields.forEach((field) => fields.add(field));
      }
    });
    return Array.from(fields);
  };

  const relevantFields = getRelevantFields();

  if (!currentUser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-3 hover:opacity-70 transition-opacity"
          >
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="font-semibold text-gray-900">LegalReview AI</h1>
              <p className="text-xs text-gray-500">Multi-Agent Legal Compliance System</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{currentUser.name}</p>
              <p className="text-xs text-gray-500">{currentUser.email}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 mr-2" />
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">기업 프로필 설정</h2>
          <p className="text-gray-600">
            검토 유형에 따라 필요한 기업 정보를 입력하세요. 
            선택한 검토 유형에 맞는 정보 입력란이 자동으로 표시됩니다.
          </p>
        </div>

        {isSaved && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 animate-in fade-in">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">프로필이 저장되었습니다</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <Card className="border-gray-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <CardTitle>기본 정보</CardTitle>
              </div>
              <CardDescription>
                기업의 기본 정보를 입력합니다
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">기업명 *</Label>
                  <Input
                    id="companyName"
                    value={profile.companyName}
                    onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
                    className="bg-white"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">웹사이트</Label>
                  <Input
                    id="website"
                    type="url"
                    placeholder="https://example.com"
                    value={profile.website}
                    onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                    className="bg-white"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="industry">산업 분야 *</Label>
                  <Select
                    value={profile.industry}
                    onValueChange={(value) => setProfile({ ...profile, industry: value })}
                  >
                    <SelectTrigger id="industry" className="bg-white">
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
                  <Label htmlFor="companySize">기업 규모</Label>
                  <Select
                    value={profile.companySize}
                    onValueChange={(value) => setProfile({ ...profile, companySize: value })}
                  >
                    <SelectTrigger id="companySize" className="bg-white">
                      <SelectValue placeholder="선택해주세요" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="startup">스타트업 (1-50명)</SelectItem>
                      <SelectItem value="small">중소기업 (51-300명)</SelectItem>
                      <SelectItem value="medium">중견기업 (301-1000명)</SelectItem>
                      <SelectItem value="large">대기업 (1000명 이상)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">기업 설명</Label>
                <Textarea
                  id="description"
                  placeholder="주요 사업 분야, 비전, 핵심 가치 등을 간단히 설명해주세요"
                  value={profile.description}
                  onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                  className="min-h-[100px] bg-white"
                />
              </div>
            </CardContent>
          </Card>

          {/* Review Types */}
          <Card className="border-gray-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <CardTitle>주요 검토 유형</CardTitle>
              </div>
              <CardDescription>
                자주 사용할 법률 검토 유형을 선택하세요 (복수 선택 가능)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {Object.entries(reviewTypeFields).map(([key, config]) => (
                  <div key={key} className="flex items-start space-x-3">
                    <Checkbox
                      id={key}
                      checked={profile.reviewTypes.includes(key)}
                      onCheckedChange={() => handleReviewTypeToggle(key)}
                    />
                    <div className="flex-1">
                      <Label htmlFor={key} className="cursor-pointer font-medium">
                        {config.label}
                      </Label>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Dynamic Fields based on Review Types */}
          {relevantFields.length > 0 && (
            <Card className="border-gray-200">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <CardTitle>상세 정보</CardTitle>
                </div>
                <CardDescription>
                  선택한 검토 유형에 필요한 추가 정보를 입력합니다
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {relevantFields.includes("mainProducts") && (
                  <div className="space-y-2">
                    <Label htmlFor="mainProducts">주요 제품/서비스</Label>
                    <Textarea
                      id="mainProducts"
                      placeholder="예: AI 기반 고객 관리 솔루션, B2B SaaS 플랫폼"
                      value={profile.mainProducts || ""}
                      onChange={(e) => setProfile({ ...profile, mainProducts: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("targetMarket") && (
                  <div className="space-y-2">
                    <Label htmlFor="targetMarket">타겟 시장</Label>
                    <Textarea
                      id="targetMarket"
                      placeholder="예: 국내 20-30대 직장인, 중소기업 마케팅 담당자"
                      value={profile.targetMarket || ""}
                      onChange={(e) => setProfile({ ...profile, targetMarket: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("competitorInfo") && (
                  <div className="space-y-2">
                    <Label htmlFor="competitorInfo">주요 경쟁사 정보</Label>
                    <Textarea
                      id="competitorInfo"
                      placeholder="예: A사, B사 등 주요 경쟁사 및 시장 포지션"
                      value={profile.competitorInfo || ""}
                      onChange={(e) => setProfile({ ...profile, competitorInfo: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("standardContracts") && (
                  <div className="space-y-2">
                    <Label htmlFor="standardContracts">표준 계약 유형</Label>
                    <Textarea
                      id="standardContracts"
                      placeholder="예: 서비스 이용 약관, B2B 계약서, 협력사 계약 등"
                      value={profile.standardContracts || ""}
                      onChange={(e) => setProfile({ ...profile, standardContracts: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("keyPartners") && (
                  <div className="space-y-2">
                    <Label htmlFor="keyPartners">주요 파트너/이해관계자</Label>
                    <Textarea
                      id="keyPartners"
                      placeholder="예: 투자사, 전략적 파트너십, 주요 공급업체"
                      value={profile.keyPartners || ""}
                      onChange={(e) => setProfile({ ...profile, keyPartners: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("regulatoryRequirements") && (
                  <div className="space-y-2">
                    <Label htmlFor="regulatoryRequirements">준수 규정/인증</Label>
                    <Textarea
                      id="regulatoryRequirements"
                      placeholder="예: 개인정보보호법, 의료기기법, ISO 인증 등"
                      value={profile.regulatoryRequirements || ""}
                      onChange={(e) => setProfile({ ...profile, regulatoryRequirements: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("irContact") && (
                  <div className="space-y-2">
                    <Label htmlFor="irContact">IR/홍보 담당자</Label>
                    <Input
                      id="irContact"
                      placeholder="예: 홍길동 이사 (ir@example.com)"
                      value={profile.irContact || ""}
                      onChange={(e) => setProfile({ ...profile, irContact: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("prHistory") && (
                  <div className="space-y-2">
                    <Label htmlFor="prHistory">최근 주요 보도/공시</Label>
                    <Textarea
                      id="prHistory"
                      placeholder="예: 최근 투자 유치, 제품 출시, 수상 이력 등"
                      value={profile.prHistory || ""}
                      onChange={(e) => setProfile({ ...profile, prHistory: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}

                {relevantFields.includes("stakeholders") && (
                  <div className="space-y-2">
                    <Label htmlFor="stakeholders">주요 이해관계자</Label>
                    <Textarea
                      id="stakeholders"
                      placeholder="예: 주주, 직원, 고객, 지역사회 등"
                      value={profile.stakeholders || ""}
                      onChange={(e) => setProfile({ ...profile, stakeholders: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notice */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-medium mb-1">프로필 활용 안내</p>
              <ul className="list-disc list-inside space-y-1 text-amber-800">
                <li>입력한 정보는 법률 검토 시 컨텍스트로 활용됩니다</li>
                <li>더 상세한 정보를 입력할수록 정확한 분석이 가능합니다</li>
                <li>언제든지 프로필을 수정할 수 있습니다</li>
              </ul>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/")}
            >
              나중에 하기
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              프로필 저장
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
