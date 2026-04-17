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
  const valueVisuals = {
    step1: "",
    step2: "",
    step3: "",
  };
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isHeaderShrunk, setIsHeaderShrunk] = useState(false);
  const [isIntroVisible, setIsIntroVisible] = useState(false);
  const [activeSection, setActiveSection] = useState("benefits");
  const [visibleSections, setVisibleSections] = useState<Record<string, boolean>>({
    benefits: false,
    "value-intro-1": false,
    "value-step-1": false,
    "value-step-2": false,
    "value-step-3": false,
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
    const navSectionIds = ["benefits", "specifications", "technology", "trust", "howto", "contact"];
    const ids = [...navSectionIds, "value-intro-1", "value-step-1", "value-step-2", "value-step-3"];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const sectionId = entry.target.id;
          if (!sectionId) return;

          setVisibleSections((prev) => ({ ...prev, [sectionId]: entry.isIntersecting }));

          if (entry.isIntersecting && navSectionIds.includes(sectionId)) {
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
    <div className="min-h-screen bg-[#ffffffff] text-slate-900">
      <div
        className={`pointer-events-none fixed inset-0 z-[60] bg-white transition-opacity duration-[1400ms] ease-out ${
          isIntroVisible ? "opacity-0" : "opacity-70"
        }`}
      />
      <header className={`sticky top-0 z-50 border-b border-[#64748B]/20 bg-[#ffffffff]/94 backdrop-blur-md transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isHeaderShrunk ? "shadow-sm" : ""}`}>
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
              가치 제안
            </button>
            <button
              onClick={() => scrollToSection("specifications")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "specifications"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              핵심 기술
            </button>
            <button
              onClick={() => scrollToSection("technology")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "technology"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              주요 기능
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
              클로징 CTA
            </button>
            <button
              onClick={() => scrollToSection("contact")}
              className={`relative pb-1 transition-colors after:absolute after:left-0 after:-bottom-[2px] after:h-[1.5px] after:w-full after:origin-left after:rounded-full after:bg-[#1E3A8A] after:transition-transform after:duration-300 after:ease-out ${
                activeSection === "contact"
                  ? "text-[#1E3A8A] after:scale-x-100"
                  : "text-[#1E293B] hover:text-black after:scale-x-0"
              }`}
            >
              문의
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
            className={`text-center text-2xl md:text-4xl font-semibold text-[#1E3A8A] mb-7 md:whitespace-nowrap transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
            className={`text-center text-lg md:text-2xl text-slate-500 max-w-6xl mx-auto mb-10 leading-relaxed transition-all duration-[1000ms] delay-100 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isIntroVisible
                ? "opacity-100 blur-0 translate-y-0"
                : "opacity-0 blur-[6px] translate-y-2"
            }`}
          >
            <span className="block md:whitespace-nowrap">즉각적인 리스크 진단부터 실질적인 비즈니스 솔루션까지, 성장의 단계에서 신뢰할 수 있는 가이드를 제시합니다.</span>
            <span className="block mt-1 md:whitespace-nowrap">데이터로 증명하고 근거로 답하는 LexRex AI로 안전한 내일을 설계하세요.</span>
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
        <div className="my-7 md:my-9 h-px w-[92%] mx-auto bg-gradient-to-r from-transparent via-[#64748B]/25 to-transparent" />

        <section id="benefits" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("benefits")}`}>
            Value
          </p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight text-[#1E3A8A] mb-7 ${getRevealClass("benefits")}`}>
            의사결정 전, 핵심 근거를 단계적으로 확인하세요.
          </h3>
          <p className={`text-lg text-slate-600 max-w-4xl leading-relaxed break-keep mb-8 ${getRevealClass("benefits")}`}>
            스크롤 흐름에 맞춰 LexRex의 핵심 가치와 데이터 기반 검토 역량을 먼저 확인한 뒤, 상세 기능 카드로 이어집니다.
          </p>
          <div id="value-intro-1" className={`rounded-3xl bg-white px-6 py-6 md:px-8 md:py-8 mb-4 ${getRevealClass("value-intro-1")}`}>
            <h4 className="text-[24px] md:text-[30px] leading-tight font-semibold mb-3 text-[#1E3A8A]">
              단일 답변의 한계를 넘은 입체적 통찰, LexRex 에이전트
            </h4>
            <p className="text-[17px] md:text-[20px] text-slate-600 leading-relaxed break-keep">
              법령, 판례, 최신 규제 데이터베이스를 바탕으로 기업의 의사결정에 꼭 필요한 다각도의 검토 결과를 쉽고 빠르게 확인하세요.
            </p>
          </div>
          <div className="space-y-8 md:space-y-14">
            <div id="value-step-1" className="min-h-[68vh] md:min-h-[82vh] grid md:grid-cols-2 gap-6 md:gap-8 items-center">
              <Card className={`h-full border-0 shadow-none bg-white ${getRevealClass("value-step-1")}`}>
                <CardContent className="h-full p-7 md:p-10 flex flex-col justify-center">
                  <div className="w-12 h-12 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-5">
                    <Scale className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <h4 className="text-[24px] md:text-[32px] leading-tight font-semibold mb-4 text-[#1E3A8A]">방대한 실시간 법률 데이터</h4>
                  <p className="text-[17px] md:text-[21px] text-slate-600 leading-relaxed break-keep">국가법령정보센터 API와 실시간 동기화된 최신 판례 및 법령 데이터를 기반으로 양질의 리스크 진단을 제공합니다.</p>
                </CardContent>
              </Card>
              <div className={`h-full min-h-[240px] md:min-h-[380px] rounded-3xl overflow-hidden border border-[#1E3A8A]/15 bg-[#F2F2F2] ${getRevealClass("value-step-1")}`}>
                <div className="w-full h-full aspect-[16/10]">
                  {valueVisuals.step1 ? (
                    <img
                      src={valueVisuals.step1}
                      alt="방대한 실시간 법률 데이터 시각 자료"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#1E3A8A]/65 text-sm md:text-base border-2 border-dashed border-[#1E3A8A]/30">
                      서비스 이미지 영역
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div id="value-step-2" className="min-h-[68vh] md:min-h-[82vh] grid md:grid-cols-2 gap-6 md:gap-8 items-center">
              <div className={`h-full min-h-[240px] md:min-h-[380px] rounded-3xl overflow-hidden border border-[#1E3A8A]/15 bg-[#F2F2F2] ${getRevealClass("value-step-2")}`}>
                <div className="w-full h-full aspect-[16/10]">
                  {valueVisuals.step2 ? (
                    <img
                      src={valueVisuals.step2}
                      alt="신뢰할 수 있는 답변 출처 시각 자료"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#1E3A8A]/65 text-sm md:text-base border-2 border-dashed border-[#1E3A8A]/30">
                      서비스 이미지 영역
                    </div>
                  )}
                </div>
              </div>
              <Card className={`h-full border-0 shadow-none bg-white ${getRevealClass("value-step-2")}`}>
                <CardContent className="h-full p-7 md:p-10 flex flex-col justify-center">
                  <div className="w-12 h-12 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-5">
                    <FileCheck className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <h4 className="text-[24px] md:text-[32px] leading-tight font-semibold mb-4 text-[#1E3A8A]">신뢰할 수 있는 답변 출처</h4>
                  <p className="text-[17px] md:text-[21px] text-slate-600 leading-relaxed break-keep">모든 답변에 법령 조항과 판례 번호를 함께 제공해 정보의 투명성과 검증 가능성을 높입니다.</p>
                </CardContent>
              </Card>
            </div>

            <div id="value-step-3" className="min-h-[68vh] md:min-h-[82vh] grid md:grid-cols-2 gap-6 md:gap-8 items-center">
              <Card className={`h-full border-0 shadow-none bg-white ${getRevealClass("value-step-3")}`}>
                <CardContent className="h-full p-7 md:p-10 flex flex-col justify-center">
                  <div className="w-12 h-12 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-5">
                    <BriefcaseBusiness className="w-5 h-5 text-[#1E3A8A] stroke-[1.8]" />
                  </div>
                  <h4 className="text-[24px] md:text-[32px] leading-tight font-semibold mb-4 text-[#1E3A8A]">맥락을 파악하는 리걸 리즈닝</h4>
                  <p className="text-[17px] md:text-[21px] text-slate-600 leading-relaxed break-keep">스타트업 특화 Legal Reasoning이 창업가의 의도를 정밀하게 파악하고 상황 맞춤형 대응 시나리오를 제시합니다.</p>
                </CardContent>
              </Card>
              <div className={`h-full min-h-[240px] md:min-h-[380px] rounded-3xl overflow-hidden border border-[#1E3A8A]/15 bg-[#F2F2F2] ${getRevealClass("value-step-3")}`}>
                <div className="w-full h-full aspect-[16/10]">
                  {valueVisuals.step3 ? (
                    <img
                      src={valueVisuals.step3}
                      alt="맥락을 파악하는 리걸 리즈닝 시각 자료"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#1E3A8A]/65 text-sm md:text-base border-2 border-dashed border-[#1E3A8A]/30">
                      서비스 이미지 영역
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="specifications" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("specifications")}`}>Core Tech</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight text-[#1E3A8A] mb-7 ${getRevealClass("specifications")}`}>
            범용 AI와 차별화된 도메인 특화 멀티 에이전트 시스템
          </h3>
          <p className={`text-lg text-slate-600 max-w-4xl leading-relaxed break-keep mb-8 ${getRevealClass("specifications")}`}>
            단순 질의응답을 넘어 법무·사업·윤리 에이전트가 상호 논증하며 최적의 판정을 도출합니다.
          </p>
          <div className="grid md:grid-cols-3 gap-5 items-stretch">
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("specifications")}`} style={{ transitionDelay: "60ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5">
                <h4 className="font-semibold mb-2 text-[#1E3A8A]">멀티 에이전트 토론 로직</h4>
                <p className="text-sm text-slate-600 break-keep">세 명의 독립된 AI 에이전트가 동일 사안을 서로 다른 시각으로 검토해 편향과 환각 현상을 낮춥니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("specifications")}`} style={{ transitionDelay: "120ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5">
                <h4 className="font-semibold mb-2 text-[#1E3A8A]">중재 및 소수 의견 병기</h4>
                <p className="text-sm text-slate-600 break-keep">의견 불일치 시 판정 에이전트가 중재안을 도출하고, 유의미한 반론은 소수 의견으로 남겨 객관성을 강화합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("specifications")}`} style={{ transitionDelay: "180ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-5 pb-5">
                <h4 className="font-semibold mb-2 text-[#1E3A8A]">고성능 분산 아키텍처</h4>
                <p className="text-sm text-slate-600 break-keep">Java Spring Boot(제어)와 Python FastAPI(추론)를 분리해 대규모 에이전트 연산을 안정적으로 처리합니다.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="technology" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("technology")}`}>Function</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight text-[#1E3A8A] mb-7 ${getRevealClass("technology")}`}>
            스타트업 맞춤형 올인원 리걸 어시스턴트
          </h3>
          <div className="grid md:grid-cols-2 gap-5 items-stretch">
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "40ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <ClipboardList className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">01</p>
                <h4 className="font-semibold mb-2">지능형 시나리오 진단</h4>
                <p className="text-sm text-slate-600">투자 계약, 지식재산권, 규제 대응 등 복잡한 경영 상황을 입력하면 즉시 분석 세션이 시작됩니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "100ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <BriefcaseBusiness className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">02</p>
                <h4 className="font-semibold mb-2">실시간 토론 모니터링</h4>
                <p className="text-sm text-slate-600">에이전트들이 논리를 주고받으며 합의점에 도달하는 과정을 투명하게 확인할 수 있습니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "160ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <FileCheck className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">03</p>
                <h4 className="font-semibold mb-2">정밀 리포트 및 재검토</h4>
                <p className="text-sm text-slate-600">분석 결과에 대한 상세 보고서를 제공하고, 조건 변경 시 즉각적인 심층 재검토가 가능합니다.</p>
              </CardContent>
            </Card>
            <Card className={`h-full border-slate-200 bg-white ${getRevealClass("technology")}`} style={{ transitionDelay: "220ms" } as React.CSSProperties}>
              <CardContent className="h-full pt-6 pb-6 flex flex-col">
                <div className="w-10 h-10 bg-[#1E3A8A]/10 border border-[#1E3A8A]/20 rounded-lg flex items-center justify-center mb-3">
                  <RotateCcw className="w-4 h-4 text-[#1E3A8A] stroke-[1.8]" />
                </div>
                <p className="text-3xl font-semibold mb-3 text-[#1E3A8A]">04</p>
                <h4 className="font-semibold mb-2">검토 이력 대시보드</h4>
                <p className="text-sm text-slate-600">과거 자문 내역과 토론 로그를 PostgreSQL 환경에 안전하게 저장해 언제든 다시 조회할 수 있습니다.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="trust" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("trust")}`}>신뢰와 보안</p>
          <h3 className={`text-[36px] md:text-[44px] leading-[1.12] font-semibold tracking-tight text-[#1E3A8A] mb-7 ${getRevealClass("trust")}`}>
            사용자의 정보는 성장을 위한 자산이며, 철저히 보호됩니다.
          </h3>
          <div className="grid lg:grid-cols-2 gap-5 items-stretch">
            <Card className={`border-slate-200 bg-white ${getRevealClass("trust")}`} style={{ transitionDelay: "50ms" } as React.CSSProperties}>
              <CardContent className="p-6 space-y-4">
                <h4 className="font-semibold">데이터 보안 원칙</h4>
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-[#F2F2F2] p-3">
                    <p className="font-medium mb-1">Zero-Retention 원칙</p>
                    <p>사용자가 입력한 데이터는 AI 모델 학습에 절대 사용되지 않으며 분석 목적 범위에서만 일시적으로 활용됩니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-[#F2F2F2] p-3">
                    <p className="font-medium mb-1">안전한 암호화 저장</p>
                    <p>모든 분석 세션 데이터는 엔터프라이즈급 PostgreSQL 환경에서 암호화되어 안전하게 관리됩니다.</p>
                  </div>
                </div>
                <h4 className="font-semibold pt-1">정확도 및 신뢰 체계</h4>
                <ul className="space-y-2 text-sm text-slate-700">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />에이전트 간 교차 검증으로 사실관계 오류를 1차 필터링</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-[#1E3A8A]" />근거 조항 번호 및 판례 번호를 답변과 함께 명시</li>
                </ul>
              </CardContent>
            </Card>
            <Card className={`border-slate-200 bg-white ${getRevealClass("trust")}`} style={{ transitionDelay: "110ms" } as React.CSSProperties}>
              <CardContent className="p-6">
                <h4 className="font-semibold mb-4">실시간 법령 동기화</h4>
                <div className="space-y-3 text-sm">
                  <div className="rounded-xl border border-slate-200 bg-[#F2F2F2] p-3">
                    <p className="font-medium text-slate-900">매일 업데이트되는 국가법령 데이터 반영</p>
                    <p className="text-slate-700 mt-1">시시각각 변하는 규제 환경에 대응할 수 있도록 법령과 판례 데이터 동기화를 지속적으로 수행합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-[#F2F2F2] p-3">
                    <p className="font-medium text-slate-900">RAG 기반 근거 검색 정확도 강화</p>
                    <p className="text-slate-700 mt-1">최신 데이터셋을 반영한 검색 파이프라인으로 답변의 근거 품질과 최신성을 유지합니다.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-[#F2F2F2] p-3">
                    <p className="font-medium text-slate-900">근거 중심 보고서</p>
                    <p className="text-slate-700 mt-1">모든 핵심 권고안에 근거 출처와 논리 과정을 함께 표시해 검증 가능한 의사결정을 지원합니다.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="howto" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("howto")}`}>Closing</p>
          <Card className={`border-slate-200 bg-white ${getRevealClass("howto")}`}>
            <CardContent className="p-7 md:p-10 text-center">
              <h3 className="text-[32px] md:text-[42px] leading-[1.15] font-semibold tracking-tight text-[#1E3A8A] mb-4">
                지속 가능한 성장을 위한 가장 스마트한 선택
              </h3>
              <p className="text-slate-600 text-lg mb-8">
                지금 바로 LexRex AI의 입체적인 법률 자문을 경험해보세요.
              </p>
              <Button
                size="lg"
                className="h-12 min-w-[280px] rounded-full bg-[#1E3A8A] hover:bg-[#172554] text-white shadow-[0_10px_24px_rgba(30,58,138,0.24)]"
                onClick={() => navigate("/signup")}
              >
                간편 가입 후 무료 진단 시작하기
                <ArrowRight className="w-5 h-5 ml-2 text-current" />
              </Button>
            </CardContent>
          </Card>
        </section>

        <section id="contact" className="scroll-mt-24 py-14 md:py-16">
          <p className={`text-sm uppercase tracking-[0.22em] text-slate-500 mb-4 ${getRevealClass("contact")}`}>문의하기</p>
          <Card className={`border-slate-200 bg-white ${getRevealClass("contact")}`}>
            <CardContent className="p-7 md:p-8">
              <h3 className="text-[32px] leading-[1.15] font-semibold tracking-tight text-[#1E3A8A] mb-3">도입 문의 및 기술 지원</h3>
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

      <footer className="border-t border-[#64748B]/25 bg-[#ffffffff] mt-24">
        <div className="max-w-7xl mx-auto px-6 py-10 text-center space-y-3">
          <p className="text-sm md:text-base font-semibold text-[#1E3A8A]">
            LexRex AI (뭐LAW노사우르스 팀)
          </p>
          <p className="text-sm text-slate-600">
            서울특별시 [대장의 주소지] l 대표이사 [대장 이름] l 사업자등록번호 [000-00-00000]
          </p>
          <p className="text-xs md:text-sm text-slate-500 leading-relaxed max-w-4xl mx-auto">
            주의사항: LexRex AI는 법률 문서의 신속한 검토 및 리스크 식별을 지원하는 AI 솔루션으로, 법률사무 처리나 법률 자문을 직접 대행하지 않습니다.
            구체적인 사안에 대해서는 반드시 변호사 등 법률 전문가의 조언을 받으시기 바랍니다.
          </p>
        </div>
      </footer>
    </div>
  );
}