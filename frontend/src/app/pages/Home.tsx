import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Shield, Scale, FileCheck, Users, ArrowRight, CheckCircle2, LogIn, UserPlus, User } from "lucide-react";

export function Home() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("legalreview_currentUser");
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">LegalReview AI</h1>
              <p className="text-xs text-gray-500">Multi-Agent Legal Compliance System</p>
            </div>
          </div>
          
          {/* Auth Buttons */}
          <div className="flex items-center gap-3">
            {currentUser ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/profile")}
                >
                  <User className="w-4 h-4 mr-2" />
                  {currentUser.name}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                >
                  로그아웃
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/login")}
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  로그인
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/signup")}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  회원가입
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full mb-6">
            <Shield className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-blue-900">기업 의사결정 지원 시스템</span>
          </div>
          
          <h2 className="text-4xl font-semibold text-gray-900 mb-4 tracking-tight">
            기업 문서·표현에 대한<br />
            <span className="text-blue-600">법적·윤리적 검토</span>를 수행합니다
          </h2>
          
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            멀티 에이전트 AI가 법률 전문가, 기업 리스크 관리자, 윤리 검토자의 시각으로
            문서와 의사결정을 다각도로 분석합니다
          </p>

          <Button 
            size="lg" 
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 h-12 shadow-lg"
            onClick={() => {
              if (currentUser) {
                navigate('/input');
              } else {
                navigate('/login');
              }
            }}
          >
            검토 시작하기
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          {!currentUser && (
            <p className="text-sm text-gray-500 mt-3">
              * 서비스 이용을 위해 로그인이 필요합니다
            </p>
          )}
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <Card className="border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <Scale className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">법률 전문가 관점</h3>
              <p className="text-sm text-gray-600">
                관련 법령, 판례, 규정을 기반으로 법적 리스크와 준수 사항을 분석합니다
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">기업 리스크 관점</h3>
              <p className="text-sm text-gray-600">
                평판 리스크, 실무적 위험, 이해관계자 영향을 종합적으로 평가합니다
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="pt-6">
              <div className="w-12 h-12 bg-violet-100 rounded-lg flex items-center justify-center mb-4">
                <FileCheck className="w-6 h-6 text-violet-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">윤리 검토 관점</h3>
              <p className="text-sm text-gray-600">
                사회적 가치, 윤리적 기준, 공정성과 투명성을 심층 분석합니다
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Process Flow */}
        <Card className="border-gray-200 bg-white">
          <CardContent className="p-8">
            <div className="flex items-center gap-2 mb-6">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">검토 프로세스</h3>
            </div>
            
            <div className="grid md:grid-cols-4 gap-4">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center mb-3">
                  <span className="font-semibold text-blue-600">1</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-1">정보 입력</h4>
                <p className="text-xs text-gray-600">회사 정보 및 검토 대상 내용을 입력합니다</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center mb-3">
                  <span className="font-semibold text-blue-600">2</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-1">에이전트 토의</h4>
                <p className="text-xs text-gray-600">다수 AI 에이전트가 다각도로 분석합니다</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center mb-3">
                  <span className="font-semibold text-blue-600">3</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-1">쟁점 분석</h4>
                <p className="text-xs text-gray-600">핵심 쟁점과 근거를 체계적으로 정리합니다</p>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-50 border-2 border-blue-200 rounded-full flex items-center justify-center mb-3">
                  <span className="font-semibold text-blue-600">4</span>
                </div>
                <h4 className="font-medium text-gray-900 mb-1">최종 권고</h4>
                <p className="text-xs text-gray-600">종합 판정과 구체적 개선안을 제시합니다</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Use Cases */}
        <div className="mt-16">
          <h3 className="text-center font-semibold text-gray-900 mb-8">활용 사례</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              "마케팅 캠페인 문구 법적 검토",
              "공시 문서 및 보도자료 리스크 분석",
              "계약서 조항 윤리적 검토",
              "사내 규정·정책 적법성 확인",
              "대외 발표 내용 평판 리스크 평가",
              "고객 대응 가이드라인 검토"
            ].map((useCase, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <span className="text-sm text-gray-700">{useCase}</span>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-24">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-gray-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}