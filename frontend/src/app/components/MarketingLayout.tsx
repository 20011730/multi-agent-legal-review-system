import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "./ui/button";
import { ArrowRight, LogIn, User, UserPlus } from "lucide-react";

interface MarketingLayoutProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

const marketingMenus = [
  { label: "서비스 소개", path: "/about" },
  { label: "전문분야", path: "/domains" },
  { label: "핵심 기술", path: "/technology" },
  { label: "신뢰와 보안", path: "/trust" },
  { label: "이용방법", path: "/how-to" },
  { label: "문의하기", path: "/contact" },
];

export function MarketingLayout({ title, description, children }: MarketingLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isPageVisible, setIsPageVisible] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    setCurrentUser(userStr ? JSON.parse(userStr) : null);
  }, [location.pathname]);

  useEffect(() => {
    setIsPageVisible(false);
    setIsOverlayVisible(true);

    const frame = window.requestAnimationFrame(() => {
      setIsPageVisible(true);
    });
    const timer = window.setTimeout(() => {
      setIsOverlayVisible(false);
    }, 260);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  const activePath = useMemo(() => {
    if (location.pathname === "/") return "";
    return location.pathname;
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem("legalreview_currentUser");
    setCurrentUser(null);
    navigate("/");
  };

  return (
    <div className="relative isolate min-h-screen bg-[#ffffffff] text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(30,58,138,0.14),transparent_36%),radial-gradient(circle_at_84%_80%,rgba(51,65,85,0.12),transparent_40%)]" />
        <div className="absolute -top-[16vh] -left-[10vw] h-[46vh] w-[46vh] rounded-full bg-[#1E3A8A]/12 blur-3xl animate-pulse" />
        <div className="absolute top-[56vh] -right-[12vw] h-[52vh] w-[52vh] rounded-full bg-[#334155]/10 blur-3xl animate-pulse [animation-delay:900ms]" />
      </div>
      <div
        className={`pointer-events-none fixed inset-0 z-[60] bg-white transition-opacity duration-500 ease-out ${
          isOverlayVisible ? "opacity-40" : "opacity-0"
        }`}
      />
      <header className="sticky top-0 z-50 border-b border-[#64748B]/20 bg-white/62 backdrop-blur-xl supports-[backdrop-filter]:bg-white/52 shadow-[0_1px_0_rgba(100,116,139,0.14)]">
        <div className="max-w-7xl mx-auto px-7 h-[68px] flex items-center justify-between">
          <button onClick={() => navigate("/")} className="min-w-[220px] text-left py-1">
            <h1 className="font-menu leading-[1.02] text-[24px] text-[#1E3A8A]">LexRex AI</h1>
            <p className="text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] mt-[3px] max-h-5">
              Multi-Agent Legal Compliance System
            </p>
          </button>

          <nav className="font-menu hidden lg:flex items-center gap-7 text-[14px]">
            {marketingMenus.map((menu) => {
              const isActive = activePath === menu.path;
              return (
                <button
                  key={menu.path}
                  onClick={() => navigate(menu.path)}
                  className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                    isActive
                      ? "text-[#1E3A8A] after:scale-x-100"
                      : "text-[#1E293B] hover:text-black after:scale-x-0"
                  }`}
                >
                  {menu.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 min-w-[198px] justify-end">
            {currentUser ? (
              <>
                <Button variant="outline" size="sm" className="h-9 rounded-full px-4" onClick={() => navigate("/profile")}>
                  <User className="w-4 h-4 mr-2 text-current" />
                  {currentUser.name}
                </Button>
                <Button variant="outline" size="sm" className="h-9 rounded-full px-4" onClick={handleLogout}>
                  <ArrowRight className="w-4 h-4 mr-2 text-current" />
                  로그아웃
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" className="h-9 rounded-full px-4" onClick={() => navigate("/login")}>
                  <LogIn className="w-4 h-4 mr-2 text-current" />
                  로그인
                </Button>
                <Button variant="outline" size="sm" className="h-9 rounded-full px-4" onClick={() => navigate("/signup")}>
                  <UserPlus className="w-4 h-4 mr-2 text-current" />
                  회원가입
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main
        className={`max-w-7xl mx-auto px-6 py-12 md:py-14 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isPageVisible ? "opacity-100 translate-y-0 blur-0" : "opacity-0 translate-y-2 blur-[2px]"
        }`}
      >
        {title && <h2 className="text-[34px] md:text-[42px] leading-[1.14] font-semibold tracking-tight text-slate-900 mb-3">{title}</h2>}
        {description && <p className="text-slate-600 max-w-4xl leading-relaxed mb-8">{description}</p>}
        {children}
      </main>

      <footer className="border-t border-[#64748B]/25 bg-[#ffffffff] mt-16">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}

