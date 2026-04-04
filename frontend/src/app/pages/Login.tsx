import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Scale, ArrowLeft, Mail, Lock, AlertCircle } from "lucide-react";

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

    // Validation
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

      // Store current user session
      localStorage.setItem("legalreview_currentUser", JSON.stringify(data));

      // Redirect to profile or home
      navigate("/profile");
    } catch (err) {
      console.error("로그인 요청 실패:", err);
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
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
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-6 py-12">
        <div className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            뒤로 가기
          </button>
          <h2 className="text-3xl font-semibold text-gray-900 mb-2">로그인</h2>
          <p className="text-gray-600">계정에 로그인하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="border-gray-200">
            <CardHeader>
              <CardTitle>계정 로그인</CardTitle>
              <CardDescription>
                등록된 이메일과 비밀번호를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">이메일</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="hong@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="pl-10 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="비밀번호를 입력하세요"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pl-10 bg-white"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={isSubmitting}
          >
            {isSubmitting ? "로그인 중..." : "로그인"}
          </Button>

          <div className="text-center text-sm text-gray-600">
            계정이 없으신가요?{" "}
            <button
              type="button"
              onClick={() => navigate("/signup")}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              회원가입
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
