import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { AlertCircle, CheckCircle2, LogOut, User2, History, UserX } from "lucide-react";

export function CompanyProfile() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (!userStr) {
      navigate("/login");
      return;
    }
    const user = JSON.parse(userStr);
    setCurrentUser(user);
    setName(user.name || "");
    setIsLoading(false);
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem("legalreview_currentUser");
    navigate("/");
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser) return;
    if (!name.trim()) {
      setError("이름을 입력해주세요.");
      return;
    }

    setError("");
    setIsSaving(true);
    try {
      const res = await fetch(`http://localhost:8080/api/users/${currentUser.id}/account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "프로필 수정 실패");
      }

      const updatedUser = { ...currentUser, name: data.name || name.trim() };
      localStorage.setItem("legalreview_currentUser", JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (saveError: any) {
      console.error(saveError);
      setError(saveError?.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!currentUser) return;
    const ok = window.confirm("정말 회원탈퇴 하시겠습니까? 이 작업은 되돌릴 수 없습니다.");
    if (!ok) return;

    setError("");
    setIsDeleting(true);
    try {
      const res = await fetch(`http://localhost:8080/api/users/${currentUser.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "회원탈퇴 실패");
      }

      localStorage.removeItem("legalreview_currentUser");
      sessionStorage.removeItem("reviewData");
      sessionStorage.removeItem("sessionId");
      sessionStorage.removeItem("finalDecision");
      sessionStorage.removeItem("evidences");
      navigate("/");
    } catch (deleteError: any) {
      console.error(deleteError);
      setError(deleteError?.message || "회원탈퇴 중 오류가 발생했습니다.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading || !currentUser) {
    return <div className="min-h-screen bg-[#ffffffff] flex items-center justify-center text-slate-500">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#ffffffff] text-slate-900">
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#ffffffff]/94 backdrop-blur-md shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate("/")} className="min-w-[220px] text-left py-1">
            <h1 className="font-menu leading-[1.02] text-[25px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            로그아웃
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h2 className="text-3xl font-semibold text-[#1E3A8A]">내 프로필</h2>
          <p className="text-slate-600 mt-1">프로필 수정, 히스토리 열람, 회원탈퇴를 관리할 수 있습니다.</p>
        </div>

        {saved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            프로필이 저장되었습니다.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User2 className="w-5 h-5 text-[#1E3A8A]" />
              프로필 수정
            </CardTitle>
            <CardDescription>이름만 수정 가능합니다. 이메일은 로그인 식별자로 고정됩니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">이메일</Label>
                <Input id="email" value={currentUser.email} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">이름</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "저장 중..." : "프로필 저장"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-[#1E3A8A]" />
              내 자문 히스토리
            </CardTitle>
            <CardDescription>이전 상담/검토 내역을 다시 열람합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/reviews")}>
              히스토리 열람
            </Button>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <UserX className="w-5 h-5" />
              회원탈퇴
            </CardTitle>
            <CardDescription className="text-red-700/80">
              탈퇴 시 계정이 삭제되며 로그인 세션이 종료됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleDeleteAccount} disabled={isDeleting} className="border-red-300 text-red-700 hover:bg-red-600 hover:text-white hover:border-red-600">
              {isDeleting ? "처리 중..." : "회원탈퇴"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
