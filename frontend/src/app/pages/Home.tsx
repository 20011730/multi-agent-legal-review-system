import React from "react";
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  Scale,
  FileCheck,
  ArrowRight,
  LogIn,
  UserPlus,
  User,
  CheckCircle2,
  Phone,
  Mail,
  BriefcaseBusiness,
  Shield,
  Landmark,
  BadgeDollarSign,
  Building2,
  UserRound,
  ClipboardList,
  RotateCcw,
} from "lucide-react";

export function Home() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isHeaderShrunk, setIsHeaderShrunk] = useState(false);
  const [isIntroVisible, setIsIntroVisible] = useState(false);
  const [activeSection, setActiveSection] = useState("benefits");
  const [visibleSections, setVisibleSections] = useState<Record<string, boolean>>({
    benefits: false,
    specifications: false,
    technology: false,
    trust: false,
    howto: false,
    contact: false,
  });
  const scrollRafRef = React.useRef<number | null>(null);
  const clickScrollRafRef = React.useRef<number | null>(null);
  const targetScrollYRef = React.useRef(0);
  const isProgrammaticScrollRef = React.useRef(false);

  useEffect(() => {
    const userStr = localStorage.getItem("legalreview_currentUser");
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setIsHeaderShrunk(window.scrollY > 28);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsIntroVisible(true);
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    targetScrollYRef.current = window.scrollY;

    const animateScroll = () => {
      const currentY = window.scrollY;
      const distance = targetScrollYRef.current - currentY;

      if (Math.abs(distance) < 0.6) {
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
        return;
      }

      // Slight inertia for a "flowing" scroll feel.
      window.scrollTo(0, currentY + distance * 0.12);
      scrollRafRef.current = requestAnimationFrame(animateScroll);
    };

    const onWheel = (event: WheelEvent) => {
      if (isProgrammaticScrollRef.current) return;
      if (event.ctrlKey || event.deltaY === 0) return;

      event.preventDefault();

      const maxScroll = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        0,
      );
      const nextTarget = targetScrollYRef.current + event.deltaY * 1.05;
      targetScrollYRef.current = Math.min(Math.max(nextTarget, 0), maxScroll);

      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(animateScroll);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", onWheel as EventListener);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (clickScrollRafRef.current !== null) {
        cancelAnimationFrame(clickScrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const ids = ["benefits", "specifications", "technology", "trust", "howto", "contact"];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const sectionId = entry.target.id;
          if (!sectionId) return;
          if (entry.isIntersecting) {
            setVisibleSections((prev) => ({ ...prev, [sectionId]: true }));
            setActiveSection(sectionId);
          }
        });
      },
      {
        root: null,
        threshold: [0.2, 0.4, 0.6],
        rootMargin: "-15% 0px -45% 0px",
      },
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("legalreview_currentUser");
    setCurrentUser(null);
  };

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (clickScrollRafRef.current !== null) {
        cancelAnimationFrame(clickScrollRafRef.current);
        clickScrollRafRef.current = null;
      }

      isProgrammaticScrollRef.current = true;
      const targetY = el.getBoundingClientRect().top + window.scrollY - 76;
      const startY = window.scrollY;
      const distance = targetY - startY;
      const duration = 900;
      const startTime = performance.now();

      const easeInOutCubic = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeInOutCubic(progress);
        window.scrollTo(0, startY + distance * eased);

        if (progress < 1) {
          clickScrollRafRef.current = requestAnimationFrame(animate);
        } else {
          isProgrammaticScrollRef.current = false;
          targetScrollYRef.current = window.scrollY;
          clickScrollRafRef.current = null;
        }
      };

      clickScrollRafRef.current = requestAnimationFrame(animate);
    }
  };

  const getRevealClass = (sectionId: string) =>
    `transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
      visibleSections[sectionId] ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
    }`;

  return (
    <div className="min-h-screen bg-[#F2F2F2] text-slate-900">
      <div
        className={`pointer-events-none fixed inset-0 z-[60] bg-white transition-opacity duration-[1400ms] ease-out ${
          isIntroVisible ? "opacity-0" : "opacity-70"
        }`}
      />
      <header className={`sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#F2F2F2]/94 backdrop-blur-md transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "shadow-sm" : ""}`}>
        <div className={`max-w-7xl mx-auto px-7 flex items-center justify-between transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "h-[62px]" : "h-[74px]"}`}>
          <button
            onClick={() => navigate("/")}
            className={`min-w-[220px] text-left transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "py-0.5" : "py-1"}`}
          >
            <h1 className={`font-menu leading-[1.02] text-[#1E3A8A] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "text-[22px]" : "text-[25px]"}`}>LexRex AI</h1>
            <p className={`text-[11px] leading-[1.3] tracking-[-0.01em] text-[#64748B] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "opacity-0 -translate-y-1 max-h-0 mt-0" : "opacity-100 translate-y-0 max-h-5 mt-[3px]"}`}>
              Multi-Agent Legal Compliance System
            </p>
          </button>

          <nav className={`font-menu hidden lg:flex items-center text-[14px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "gap-6" : "gap-8"}`}>
            <button
              onClick={() => scrollToSection("benefits")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "benefits"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              서비스 소개
            </button>
            <button
              onClick={() => scrollToSection("specifications")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "specifications"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              전문분야
            </button>
            <button
              onClick={() => scrollToSection("howto")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "technology"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              핵심 기술
            </button>
            <button
              onClick={() => scrollToSection("trust")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "trust"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              신뢰와 보안
            </button>
            <button
              onClick={() => scrollToSection("howto")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "howto"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              이용방법
            </button>
            <button
              onClick={() => scrollToSection("contact")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "contact"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              문의하기
            </button>
          </nav>

          <div className="flex items-center gap-2 min-w-[198px] justify-end">
            {currentUser ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
                  onClick={() => navigate("/profile")}
                >
                  <User className="w-4 h-4 mr-2 text-current" />
                  {currentUser.name}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
                  onClick={handleLogout}
                >
                  <ArrowRight className="w-4 h-4 mr-2 text-current" />
                  로그아웃
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
                  onClick={() => navigate("/login")}
                >
                  <LogIn className="w-4 h-4 mr-2 text-current" />
                  로그인
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full border border-transparent bg-transparent px-4 text-[#4B5563] hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-all duration-300 hover:shadow-[0_8px_18px_rgba(30,58,138,0.22)]"
                  onClick={() => navigate("/signup")}
                >
                  <UserPlus className="w-4 h-4 mr-2 text-current" />
                  회원가입
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1240px] mx-auto px-5 md:px-6 py-12 md:py-14">
        <section className="pt-8 md:pt-10 pb-14 md:pb-16">
          <p
            className={`text-center text-2xl md:text-4xl font-semibold text-slate-600 mb-7 transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible
                ? "opacity-100 blur-0 translate-y-0"
                : "opacity-0 blur-[6px] translate-y-2"
            }`}
          >
            혁신 성장의 법률적 토대, LexRex AI가 함께합니다.
          </p>

          <h2
            className={`font-menu text-center text-7xl md:text-9xl font-bold tracking-[-0.03em] leading-[1.02] mb-8 text-[#1E3A8A] transition-all duration-[1900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible
                ? "opacity-100 blur-0 translate-y-0"
                : "opacity-0 blur-[7px] translate-y-2"
            }`}
          >
            LexRex AI
          </h2>
          <p
            className={`text-center text-lg md:text-2xl text-slate-500 max-w-5xl mx-auto mb-10 leading-relaxed transition-all duration-[1000ms] delay-100 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible
                ? "opacity-100 blur-0 translate-y-0"
                : "opacity-0 blur-[6px] translate-y-2"
            }`}
          >
            <span className="block">신기술·신산업 현장에서 발생하는 복잡한 법률 이슈, 이제 비용 걱정 없이 AI 어시스턴트로 해결하세요.</span>
            <span className="block mt-1">투자 계약부터 지식재산권 보호까지, 성장의 단계에서 신뢰할 수 있는 가이드를 제시합니다.</span>
          </p>

          <div
            className={`flex justify-center mb-12 transition-all duration-[1400ms] delay-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible
                ? "opacity-100 blur-0 translate-y-0"
                : "opacity-0 blur-[5px] translate-y-2"
            }`}
          >
            <Button
              size="lg"
              className="h-12 min-w-[250px] px-6 rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap border border-[#64748B]/45 bg-white text-[#64748B] hover:bg-[#1E3A8A] hover:border-[#1E3A8A] hover:text-white transition-all duration-300 shadow-sm hover:shadow-[0_10px_24px_rgba(30,58,138,0.22)]"
              onClick={() => {
                if (currentUser) {
                  navigate("/input");
                } else {
                  navigate("/login");
                }
              }}
            >
              법률 리스크 진단하기
              <ArrowRight className="w-5 h-5 text-current transition-colors" />
            </Button>
          </div>

          <div className="relative rounded-3xl overflow-hidden border border-[#64748B]/25 bg-white shadow-sm max-w-[98%] mx-auto">
            <div className="h-64 md:h-[420px] bg-[linear-gradient(180deg,#bad2e6_0%,#8eb2cf_35%,#7f9fbc_100%)]" />
            <div className="absolute inset-x-0 -bottom-16 mx-auto w-[94%] h-56 rounded-3xl bg-[#9ba487]/65 -z-10" />
            <div className="absolute top-5 left-6 text-white">
              <p className="text-xs opacity-80">Reports · Overview</p>
              <p className="text-4xl font-medium mt-2">78%</p>
              <p className="text-sm opacity-90">Efficiency Improvements</p>
            </div>
          </div>
        </section>

        <section id="benefits" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("benefits")}`}>
            서비스 소개
          </p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight mb-7 ${getRevealClass("benefits")}`}>
            법무·사업·윤리 관점의 멀티 에이전트 토론 시스템
          </h3>
          <p className={`text-lg text-slate-600 max-w-4xl leading-relaxed break-keep mb-8 ${getRevealClass("benefits")}`}>
            LexRex AI는 단순 질의응답형 AI가 아닌, <strong>법무·사업·윤리</strong> 세 에이전트가 동일 사안을 토론하고
            교차 검증하여 최적의 판정을 도출하는 <strong>멀티 에이전트 법률 자문 시스템</strong>입니다.
            초기 기업이 겪는 법률 리스크와 고비용 자문 부담을 줄여 더 빠르고 안전한 의사결정을 지원합니다.
          </p>
          <div className="grid md:grid-cols-3 gap-5 items-stretch">
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("benefits")}`} style={{ transitionDelay: "60ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5 flex flex-col">
                <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
                  <Scale className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <h4 className="font-semibold mb-2">법무 에이전트</h4>
                <p className="text-sm text-slate-600 break-keep">법령, 판례, 계약 조항 관점에서 법적 위험을 구조화합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("benefits")}`} style={{ transitionDelay: "120ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5 flex flex-col">
                <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
                  <BriefcaseBusiness className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <h4 className="font-semibold mb-2">사업 에이전트</h4>
                <p className="text-sm text-slate-600 break-keep">비즈니스 실행성과 성장 전략 관점에서 현실적인 대안을 제시합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("benefits")}`} style={{ transitionDelay: "180ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5 flex flex-col">
                <div className="w-11 h-11 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-4">
                  <FileCheck className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <h4 className="font-semibold mb-2">윤리 에이전트</h4>
                <p className="text-sm text-slate-600 break-keep">사회적 신뢰와 기업 평판 관점에서 커뮤니케이션 리스크를 보완합니다.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="specifications" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("specifications")}`}>전문분야</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight mb-7 ${getRevealClass("specifications")}`}>스타트업 핵심 법률 이슈</h3>
          <Card className={`border-slate-200 bg-white ${getRevealClass("specifications")}`}>
            <CardContent className="p-4 md:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[10px] items-stretch">
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <Scale className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">계약·거래</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">비즈니스 파트너와의 계약, 물품공급계약 등</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <Landmark className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">지식재산·브랜드</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">지식재산권을 보호하기 위한 법률적 대응</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <Shield className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">개인정보·데이터</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">개인정보 처리 및 보호에 대한 법률 자문</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <ClipboardList className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[13.5px] lg:text-[14px] min-[1200px]:text-[14.5px] min-[1440px]:text-[15px] leading-[1.2] tracking-[-0.022em] whitespace-nowrap font-semibold text-[#111827]">규제·인허가 대응</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">인허가 획득 및 신산업 법규제 준수 가이드</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <UserRound className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">인사·노무</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">노동갈등이나 인사노무 관련 분야의 지원</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <BadgeDollarSign className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">투자·자금조달</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">투자 계약 및 라운드 협의 관련 법률적 지원</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[14px] lg:text-[14.5px] min-[1200px]:text-[15px] min-[1440px]:text-[15.5px] leading-[1.2] tracking-[-0.018em] whitespace-nowrap font-semibold text-[#111827]">기업운영·법무</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">기업 경영에 필요한 기본적 법률 검토 사항</p>
                </div>
                <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 min-h-[104px] h-full flex flex-col justify-between">
                  <div className="w-8 h-8 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-md flex items-center justify-center">
                    <RotateCcw className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <p className="text-[13.5px] lg:text-[14px] min-[1200px]:text-[14.5px] min-[1440px]:text-[15px] leading-[1.2] tracking-[-0.022em] whitespace-nowrap font-semibold text-[#111827]">사업정리·재도전</p>
                  <p className="text-[10.5px] lg:text-[10.5px] min-[1200px]:text-[11px] min-[1440px]:text-[11.5px] leading-[1.2] tracking-[-0.022em] min-[1200px]:tracking-[-0.02em] whitespace-nowrap text-[#64748B]">폐업청산, 철수, 회생파산, 재창업 관련 법률지원</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="technology" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("technology")}`}>핵심 기술</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight mb-7 ${getRevealClass("technology")}`}>
            왜 LexRex AI인가: 토론형 AI 아키텍처
          </h3>
          <p className={`text-lg text-slate-600 max-w-4xl leading-relaxed break-keep mb-8 ${getRevealClass("technology")}`}>
            LexRex AI는 <strong>Spring Boot(제어)</strong>와 <strong>FastAPI(추론)</strong>를 분리한 구조 위에서,
            독립 프롬프트 페르소나를 가진 에이전트들이 논점을 교차 검증합니다.
            불일치가 발생하면 판정 에이전트가 법적 근거 가중치를 반영해 중재안을 도출하고,
            유의미한 반론은 <strong>소수 의견(Minority Opinion)</strong>으로 함께 제공합니다.
          </p>
          <div className="grid lg:grid-cols-2 gap-5 items-stretch">
            <Card className={`border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "50ms" } as React.CSSProperties}>
              <CardContent className="p-6">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500 mb-3">Mediation Logic</p>
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold mb-1">1) 독립 의견 생성</p>
                    <p>법무·사업·윤리 에이전트가 같은 입력을 서로 다른 관점으로 분석합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold mb-1">2) 충돌 탐지 및 중재</p>
                    <p>근거 조항, 사업 실행성, 평판 리스크를 가중치로 비교해 판정안을 정리합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold mb-1">3) 소수 의견 병기</p>
                    <p>최종 합의 밖의 유의미한 반론도 리포트 하단에 함께 남겨 판단 편향을 줄입니다.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "110ms" } as React.CSSProperties}>
              <CardContent className="p-6">
                <p className="text-sm uppercase tracking-[0.18em] text-slate-500 mb-3">System Architecture</p>
                <div className="rounded-2xl border border-[#CBD5E1] bg-[#F8FAFC] p-5">
                  <div className="grid grid-cols-1 gap-3 text-sm">
                    <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                      <p className="font-semibold text-[#1E3A8A]">Client / UI</p>
                      <p className="text-slate-600">분석 요청 · 실시간 토론 상태 · 결과 리포트 제공</p>
                    </div>
                    <div className="text-center text-slate-400">↓</div>
                    <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                      <p className="font-semibold text-[#1E3A8A]">Spring Boot Orchestrator</p>
                      <p className="text-slate-600">세션 제어, 인증, 라우팅, 작업 상태 관리</p>
                    </div>
                    <div className="text-center text-slate-400">↓</div>
                    <div className="rounded-lg border border-[#1E3A8A]/20 bg-white p-3">
                      <p className="font-semibold text-[#1E3A8A]">FastAPI Inference + RAG</p>
                      <p className="text-slate-600">법령/판례 근거 검색 후 멀티 에이전트 토론 및 합의</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="trust" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("trust")}`}>신뢰와 보안</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight mb-7 ${getRevealClass("trust")}`}>
            데이터는 안전한가: 업데이트·정확도·프라이버시 원칙
          </h3>
          <div className="grid lg:grid-cols-2 gap-5 items-stretch">
            <Card className={`border-slate-200 bg-white ${getRevealClass("trust")}`} style={{ transitionDelay: "50ms" } as React.CSSProperties}>
              <CardContent className="p-6 space-y-4">
                <h4 className="font-semibold">법령 데이터 업데이트 체계</h4>
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium mb-1">실시간 동기화</p>
                    <p>국가법령정보센터 API 연동으로 최신 공포 법령·판례를 주기적으로 반영합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium mb-1">스케줄링 크롤링</p>
                    <p>신규 해석례와 가이드라인은 주 단위로 수집해 RAG 인덱스를 업데이트합니다.</p>
                  </div>
                </div>
                <h4 className="font-semibold pt-1">정확도 보장 체계</h4>
                <ul className="space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />에이전트 간 교차 검증으로 사실관계 오류를 1차 필터링</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />근거 조항 번호 및 판례 번호를 답변과 함께 명시</li>
                </ul>
              </CardContent>
            </Card>
            <Card className={`border-slate-200 bg-white ${getRevealClass("trust")}`} style={{ transitionDelay: "110ms" } as React.CSSProperties}>
              <CardContent className="p-6">
                <h4 className="font-semibold mb-4">Trust Checklist (FAQ 스타일)</h4>
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">Q. 입력 데이터가 외부 모델 학습에 사용되나요?</p>
                    <p className="text-slate-700 mt-1">A. 사용되지 않습니다. 사용자 입력은 재학습 데이터로 제공하지 않는 것을 원칙으로 합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">Q. 분석 세션 데이터는 어떻게 관리되나요?</p>
                    <p className="text-slate-700 mt-1">A. 저장 시 암호화하고, 요청 시 즉시 삭제 가능한 Zero-Retention 정책을 따릅니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">Q. 결과의 신뢰도는 어떻게 확인하나요?</p>
                    <p className="text-slate-700 mt-1">A. 멀티 에이전트 상호 검증 로그와 근거 출처를 함께 제공하여 판단 근거를 투명하게 확인할 수 있습니다.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="howto" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("howto")}`}>이용방법</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight mb-7 ${getRevealClass("howto")}`}>4단계 컴플라이언스 프로세스</h3>
          <div className="grid md:grid-cols-2 gap-5 items-stretch">
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("howto")}`} style={{ transitionDelay: "40ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <ClipboardList className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">01</p>
                <h4 className="font-semibold mb-2">시나리오 입력</h4>
                <p className="text-sm text-slate-600">검토 대상 문구·상황·배경 정보를 입력합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("howto")}`} style={{ transitionDelay: "100ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <BriefcaseBusiness className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">02</p>
                <h4 className="font-semibold mb-2">멀티 에이전트 토론</h4>
                <p className="text-sm text-slate-600">법무·사업·윤리 관점 에이전트가 교차 토론합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("howto")}`} style={{ transitionDelay: "160ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <FileCheck className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">03</p>
                <h4 className="font-semibold mb-2">최종 판정 보고서</h4>
                <p className="text-sm text-slate-600">핵심 리스크, 수정 권고안, 근거를 포함한 결과를 제공합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("howto")}`} style={{ transitionDelay: "220ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <RotateCcw className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">04</p>
                <h4 className="font-semibold mb-2">심층 재검토</h4>
                <p className="text-sm text-slate-600">조건 변경 및 추가 질문으로 재토론해 판정 정밀도를 높입니다.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="contact" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("contact")}`}>문의하기</p>
          <Card className={`border-slate-200 bg-white ${getRevealClass("contact")}`}>
            <CardContent className="p-7 md:p-8">
              <h3 className="text-[32px] leading-[1.15] font-semibold tracking-tight mb-3">도입 문의 및 기술 지원</h3>
              <p className="text-slate-600 mb-6">
                서비스 도입 상담이 필요하거나 기술 지원이 필요하다면 아래 정보를 남겨주세요.
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
                <Button className="bg-[#1E3A8A] hover:bg-[#1E293B] text-white rounded-full px-6 shadow-[0_8px_20px_rgba(30,58,138,0.24)]">
                  문의 보내기
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-[#64748B]/25 bg-[#F2F2F2] mt-24">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-500">
            본 시스템은 의사결정 지원을 위한 참고 자료이며, 최종 판단은 실무 전문가와 법무팀의 검토가 필요합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}