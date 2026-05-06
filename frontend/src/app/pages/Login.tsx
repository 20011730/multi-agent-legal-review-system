import React from "react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Mail, Lock, AlertCircle, UserPlus, ArrowRight, Github } from "lucide-react";

export function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.email || !formData.password) {
      setError("이메일과 비밀번호를 입력해주세요");
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const res = await fetch("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });
      
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "로그인에 실패했습니다");
        setIsSubmitting(false);
        return;
      }

      localStorage.setItem("legalreview_currentUser", JSON.stringify(data));
      navigate("/profile");
    } catch (err) {
      console.error("로그인 요청 실패:", err);
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "pl-10 h-11 rounded-xl border border-[#64748B]/35 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/20 focus-visible:border-[#1E3A8A]";

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-5 md:px-7 flex items-center justify-between h-[74px]">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="min-w-[200px] text-left py-1"
          >
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
            onClick={() => navigate("/signup")}
          >
            <UserPlus className="w-4 h-4 mr-2 text-current" />
            회원가입
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-[1240px] w-full mx-auto px-5 md:px-6 py-12 md:py-14">
        <div className="max-w-md mx-auto">
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 text-center">Sign In</p>
          <h2 className="font-menu text-center text-3xl md:text-4xl font-bold tracking-tight text-[#1E3A8A] mb-3">
            로그인
          </h2>
          <p className="text-center text-slate-600 text-sm md:text-base leading-relaxed mb-8 break-keep">
            계정에 로그인해 멀티 에이전트 법률 검토를 이어가세요.
          </p>

          <Card className="border-slate-200 bg-white shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="space-y-1 px-6 pt-6 pb-2">
              <CardTitle className="text-lg font-semibold tracking-tight text-slate-900 sr-only">로그인 폼</CardTitle>
              <CardDescription className="text-slate-600">이메일과 비밀번호를 입력해주세요</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" className="h-10 rounded-xl" disabled>
                    <svg viewBox="0 0 24 24" className="w-4 h-4 mr-2" aria-hidden="true">
                      <path fill="currentColor" d="M12 10.2v3.9h5.4c-.2 1.2-1.4 3.6-5.4 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.1 14.7 2 12 2 6.9 2 2.8 6.1 2.8 11.2S6.9 20.4 12 20.4c6.9 0 9.1-4.8 9.1-7.3 0-.5 0-.9-.1-1.3H12z" />
                    </svg>
                    구글 로그인(준비중)
                  </Button>
                  <Button type="button" variant="outline" className="h-10 rounded-xl" disabled>
                    <Github className="w-4 h-4 mr-2" />
                    GitHub 로그인(준비중)
                  </Button>
                </div>

                {error && (
                  <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700">
                    이메일
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="hong@example.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-700">
                    비밀번호
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="비밀번호를 입력하세요"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 rounded-full bg-[#1E3A8A] hover:bg-[#1E293B] text-white shadow-[0_8px_20px_rgba(30,58,138,0.24)]"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "로그인 중..." : "로그인"}
                </Button>

                <div className="text-center text-sm text-slate-600 pt-1">
                  계정이 없으신가요?{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/signup")}
                    className="text-[#1E3A8A] hover:text-[#1E293B] font-medium underline-offset-4 hover:underline"
                  >
                    회원가입
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="mt-8 flex justify-center">
            <Button
              variant="outline"
              size="lg"
              className="h-12 min-w-[220px] px-6 rounded-full inline-flex items-center justify-center gap-2 border border-[#64748B]/45 bg-white text-[#64748B] hover:bg-[#1E3A8A] hover:border-[#1E3A8A] hover:text-white transition-all duration-300 shadow-sm hover:shadow-[0_10px_24px_rgba(30,58,138,0.22)]"
              onClick={() => navigate("/")}
            >
              홈으로 돌아가기
              <ArrowRight className="w-5 h-5 text-current" />
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#64748B]/25 bg-[#F2F2F2] mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
