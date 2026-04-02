import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Textarea } from "../components/ui/textarea";
import {
  Scale,
  ArrowRight,
  Scale as LegalIcon,
  Shield,
  FileCheck,
  Loader2,
  CheckCircle,
  User,
  Send,
  MessageSquare,
} from "lucide-react";

interface Agent {
  id: string;
  name: string;
  role: string;
  icon: typeof LegalIcon;
  color: string;
  bgColor: string;
  borderColor: string;
}

interface Message {
  agentId: string | "user";
  timestamp: number;
  content: string;
  type:
    | "analysis"
    | "concern"
    | "recommendation"
    | "user-input";
  round?: number;
}

const agents: Agent[] = [
  {
    id: "legal",
    name: "법률 전문가",
    role: "Legal Counsel",
    icon: Scale,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    id: "risk",
    name: "리스크 관리자",
    role: "Risk Manager",
    icon: Shield,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  {
    id: "ethics",
    name: "윤리 검토자",
    role: "Ethics Reviewer",
    icon: FileCheck,
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
  },
];

// Mock discussion messages organized by rounds
const generateDiscussionByRounds = () => {
  return [
    // Round 1
    [
      {
        agentId: "legal",
        timestamp: 1,
        type: "analysis" as const,
        round: 1,
        content:
          "검토 시작: 표시·광고의 공정화에 관한 법률 제3조 및 제4조를 기준으로 분석하겠습니다. '업계 1위 제품보다 2배 빠른 성능'이라는 표현에 대한 객관적 근거 자료 확인이 필요합니다.",
      },
      {
        agentId: "risk",
        timestamp: 2,
        type: "analysis" as const,
        round: 1,
        content:
          "비교 광고 측면에서 리스크를 검토하겠습니다. 특정 경쟁사를 직접 지칭하지는 않았으나, '업계 1위'라는 표현이 특정 업체를 암시할 수 있습니다. 경쟁사의 대응 가능성을 고려해야 합니다.",
      },
      {
        agentId: "ethics",
        timestamp: 3,
        type: "concern" as const,
        round: 1,
        content:
          "'타사 제품은 구시대 유물'이라는 표현에서 과도한 비하 표현이 감지됩니다. 경쟁사에 대한 존중 부족은 기업 이미지에 부정적 영향을 줄 수 있습니다.",
      },
    ],
    // Round 2
    [
      {
        agentId: "legal",
        timestamp: 4,
        type: "concern" as const,
        round: 2,
        content:
          "표시광고법 제3조 제1항 제1호 '거짓·과장 광고'에 해당할 가능성이 있습니다. '2배 빠른 성능'에 대한 시험·조사 기관의 객관적 검증 자료가 없다면 법적 분쟁 소지가 있습니다. 공정거래위원회 제재 사례 검토 필요.",
      },
      {
        agentId: "risk",
        timestamp: 5,
        type: "concern" as const,
        round: 2,
        content:
          "'한정 수량', '지금 구매', '놓치면 후회' 등 긴박감 조성 표현이 과도합니다. 실제 재고 상황과 무관한 허위 희소성 강조는 소비자 기만으로 간주될 수 있으며, 소비자 불만 및 환불 요구 증가 가능성이 있습니다.",
      },
      {
        agentId: "ethics",
        timestamp: 6,
        type: "analysis" as const,
        round: 2,
        content:
          "소비자 자율성 존중 관점에서 검토합니다. '서둘러 주문', '후회합니다' 등의 압박적 표현은 소비자의 합리적 판단을 방해할 수 있습니다. ESG 경영 측면에서 소비자 중심적 커뮤니케이션이 필요합니다.",
      },
    ],
    // Round 3
    [
      {
        agentId: "legal",
        timestamp: 7,
        type: "recommendation" as const,
        round: 3,
        content:
          "법적 안전성 확보를 위해 다음을 권고합니다: 1) 성능 비교 데이터의 출처 명시 2) '당사 기준' 또는 '특정 조건 하' 등 한정 표현 추가 3) 비교 대상 제품의 구체적 명시 또는 일반화된 표현으로 수정",
      },
      {
        agentId: "risk",
        timestamp: 8,
        type: "recommendation" as const,
        round: 3,
        content:
          "리스크 완화 방안: 1) 경쟁사 비하 표현 전면 삭제 2) 할인율 및 사은품 관련 상세 조건 명시 3) 한정 수량의 실제 물량 및 기간 구체화 4) 사후 소비자 불만 대응 프로세스 사전 준비",
      },
      {
        agentId: "ethics",
        timestamp: 9,
        type: "recommendation" as const,
        round: 3,
        content:
          "윤리적 개선 방안: 1) 자사 제품의 강점을 긍정적으로 표현 (비교 대신 절대적 가치 강조) 2) 소비자 선택권 존중하는 톤앤매너 적용 3) 압박적 표현 대신 혜택 중심 정보 제공 4) 공정하고 투명한 커뮤니케이션 원칙 준수",
      },
    ],
  ];
};

export function Result() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentMessageIndex, setCurrentMessageIndex] =
    useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [participationMode, setParticipationMode] = useState<
    "observe" | "participate"
  >("observe");
  const [waitingForUserInput, setWaitingForUserInput] =
    useState(false);
  const [userInput, setUserInput] = useState("");
  const [allRounds] = useState(generateDiscussionByRounds());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize and load participation mode
  useEffect(() => {
    const reviewData = sessionStorage.getItem("reviewData");
    if (!reviewData) {
      navigate("/input");
      return;
    }

    const data = JSON.parse(reviewData);
    setParticipationMode(data.participationMode || "observe");
  }, [navigate]);

  // Handle message progression
  useEffect(() => {
    // Don't start if waiting for user input or already complete
    if (waitingForUserInput || isComplete) {
      return;
    }

    // Check if we have valid round data
    if (currentRound > allRounds.length) {
      setIsComplete(true);
      setProgress(100);
      return;
    }

    const currentRoundMessages = allRounds[currentRound - 1];

    // If we've shown all messages in this round
    if (currentMessageIndex >= currentRoundMessages.length) {
      // Check if this is the last round
      if (currentRound >= 3) {
        setIsComplete(true);
        setProgress(100);
        return;
      }

      // If participate mode, wait for user input
      if (participationMode === "participate") {
        setWaitingForUserInput(true);
        return;
      }

      // Otherwise, move to next round after a delay (observe mode)
      const timeout = setTimeout(() => {
        setCurrentRound(currentRound + 1);
        setCurrentMessageIndex(0);
      }, 1500);

      return () => clearTimeout(timeout);
    }

    // Show next message after a delay
    const timeout = setTimeout(() => {
      const nextMessage =
        currentRoundMessages[currentMessageIndex];
      setMessages((prev) => [...prev, nextMessage]);

      // Update progress
      const totalMessages = allRounds.flat().length;
      setProgress(
        ((messages.length + 1) / totalMessages) * 100,
      );

      setCurrentMessageIndex(currentMessageIndex + 1);
    }, 1200);

    return () => clearTimeout(timeout);
  }, [
    currentRound,
    currentMessageIndex,
    waitingForUserInput,
    isComplete,
    participationMode,
    allRounds,
    messages.length,
  ]);

  const handleUserSubmit = () => {
    if (!userInput.trim()) return;

    // Add user message
    const userMessage: Message = {
      agentId: "user",
      timestamp: Date.now(),
      content: userInput,
      type: "user-input",
      round: currentRound,
    };

    setMessages((msgs) => [...msgs, userMessage]);
    setUserInput("");
    setWaitingForUserInput(false);

    // Move to next round
    setTimeout(() => {
      setCurrentRound(currentRound + 1);
      setCurrentMessageIndex(0);
    }, 500);
  };

  const handleSkipInput = () => {
    setWaitingForUserInput(false);

    // Move to next round
    setTimeout(() => {
      setCurrentRound(currentRound + 1);
      setCurrentMessageIndex(0);
    }, 500);
  };

  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "concern":
        return (
          <Badge variant="destructive" className="text-xs">
            쟁점
          </Badge>
        );
      case "recommendation":
        return (
          <Badge className="bg-green-600 text-xs">권고</Badge>
        );
      case "user-input":
        return (
          <Badge className="bg-purple-600 text-xs">
            사용자 의견
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs">
            분석
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <Scale className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">
                LegalReview AI
              </h1>
              <p className="text-xs text-gray-500">
                Multi-Agent Legal Compliance System
              </p>
            </div>
          </div>
          {isComplete && (
            <Button
              onClick={() => navigate("/verdict")}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              최종 판정 보기
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-semibold text-gray-900 mb-2">
                에이전트 토의 진행중
              </h2>
              <p className="text-gray-600">
                {participationMode === "participate"
                  ? "다수의 AI 에이전트가 검토를 진행하고 있습니다. 각 라운드 후 의견을 추가할 수 있습니다."
                  : "다수의 AI 에이전트가 다각도로 검토를 진행하고 있습니다"}
              </p>
            </div>
            <Badge className="bg-blue-100 text-blue-700">
              라운드 {currentRound} / 3
            </Badge>
          </div>
        </div>

        {/* Progress */}
        <Card className="border-gray-200 mb-8">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">
                검토 진행률
              </span>
              <span className="text-sm font-medium text-blue-600">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            {!isComplete && !waitingForUserInput && (
              <div className="flex items-center gap-2 mt-4 text-sm text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>에이전트가 분석 중입니다...</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agents Overview */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {agents.map((agent) => {
            const Icon = agent.icon;
            const agentMessages = messages.filter(
              (m) => m.agentId === agent.id,
            );
            const isActive =
              messages.length > 0 &&
              messages[messages.length - 1].agentId ===
                agent.id;

            return (
              <Card
                key={agent.id}
                className={`border-2 transition-all ${
                  isActive
                    ? `${agent.borderColor} shadow-lg scale-105`
                    : "border-gray-200"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 ${agent.bgColor} rounded-lg flex items-center justify-center`}
                    >
                      <Icon
                        className={`w-5 h-5 ${agent.color}`}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {agent.name}
                      </CardTitle>
                      <p className="text-xs text-gray-500">
                        {agent.role}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">
                      {agentMessages.length}
                    </span>
                    개 메시지
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Discussion Timeline */}
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle>토의 로그</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {messages.map((message, index) => {
                if (message.agentId === "user") {
                  // User message
                  return (
                    <div
                      key={index}
                      className="flex gap-4 p-4 rounded-lg border-l-4 border-purple-200 bg-purple-50 animate-in fade-in slide-in-from-bottom-4"
                    >
                      <div className="w-10 h-10 bg-purple-100 border border-purple-200 rounded-lg flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-purple-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-purple-700">
                            사용자 의견
                          </span>
                          {getTypeBadge(message.type)}
                          <span className="text-xs text-gray-500">
                            라운드 {message.round} 종료 후
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {message.content}
                        </p>
                      </div>
                    </div>
                  );
                }

                const agent = getAgent(message.agentId);
                if (!agent) return null;
                const Icon = agent.icon;

                return (
                  <div
                    key={index}
                    className={`flex gap-4 p-4 rounded-lg border-l-4 ${agent.borderColor} ${agent.bgColor} animate-in fade-in slide-in-from-bottom-4`}
                  >
                    <div
                      className={`w-10 h-10 ${agent.bgColor} border ${agent.borderColor} rounded-lg flex items-center justify-center flex-shrink-0`}
                    >
                      <Icon
                        className={`w-5 h-5 ${agent.color}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`font-medium ${agent.color}`}
                        >
                          {agent.name}
                        </span>
                        {getTypeBadge(message.type)}
                        <span className="text-xs text-gray-500">
                          라운드 {message.round}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {message.content}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* User Input Section */}
            {waitingForUserInput && (
              <div className="mt-6 p-6 bg-purple-50 border-2 border-purple-200 rounded-lg animate-in fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare className="w-5 h-5 text-purple-600" />
                  <h4 className="font-semibold text-gray-900">
                    라운드 {currentRound} 종료 - 의견 입력
                  </h4>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  에이전트들의 분석에 대해 질문하거나 반박할
                  내용이 있으신가요? 의견을 입력하시면 다음
                  라운드에서 에이전트들이 이를 고려하여 검토를
                  진행합니다.
                </p>
                <Textarea
                  placeholder="예: '2배 빠른 성능'은 당사의 내부 벤치마크 테스트 결과입니다. 제3자 검증은 비용 문제로 진행하지 못했는데, 이 경우에도 문제가 될까요?"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  className="min-h-[100px] bg-white mb-4"
                />
                <div className="flex gap-3">
                  <Button
                    onClick={handleUserSubmit}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={!userInput.trim()}
                  >
                    <Send className="mr-2 w-4 h-4" />
                    의견 제출
                  </Button>
                  <Button
                    onClick={handleSkipInput}
                    variant="outline"
                  >
                    건너뛰기
                  </Button>
                </div>
              </div>
            )}

            {!isComplete &&
              !waitingForUserInput &&
              messages.length > 0 && (
                <div className="flex items-center gap-2 mt-6 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>다음 에이전트 응답 대기중...</span>
                </div>
              )}

            {isComplete && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">
                    토의가 완료되었습니다
                  </span>
                </div>
                <p className="text-sm text-green-700 mt-1">
                  모든 에이전트의 분석이 완료되었습니다. 최종
                  판정 보고서를 확인하세요.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}