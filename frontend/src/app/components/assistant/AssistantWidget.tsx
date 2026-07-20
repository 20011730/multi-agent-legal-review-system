import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { Button } from "../ui/button";

type ChatRole = "assistant" | "user";

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

interface ServerMessage {
  id?: number | string;
  role?: string;
  message?: string;
  content?: string;
  createdAt?: string;
  messageOrder?: number;
}

const WELCOME_MESSAGE =
  "안녕하세요. 현재 검토 내용을 바탕으로 핵심 위험 요소와 다음 확인 사항을 쉽게 설명해드릴게요. 궁금한 내용을 질문해주세요.";

const RECOMMENDED_QUESTIONS = [
  "가장 중요한 위험 요소를 쉽게 설명해줘",
  "지금 가장 먼저 확인해야 할 문서는 무엇인가요?",
  "최종 판정의 의미를 쉽게 설명해줘",
  "근거 카드가 어떤 의미인지 알려줘",
  "지원사업 신청 전에 해야 할 일을 정리해줘",
];

function makeMessage(role: ChatRole, text: string): ChatMessage {
  const createdAt = new Date().toISOString();
  return {
    id: `${role}-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt,
  };
}

function getCurrentSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const reviewMatch = window.location.pathname.match(/^\/reviews\/(\d+)/);
  if (reviewMatch?.[1]) return reviewMatch[1];
  return (
    sessionStorage.getItem("sessionId") ||
    sessionStorage.getItem("currentSessionId") ||
    localStorage.getItem("lastSessionId")
  );
}

function storageKey(sessionId: string | null): string {
  return `lexrex.assistant.messages.${sessionId || "no-session"}`;
}

function loadMessages(sessionId: string | null): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return [makeMessage("assistant", WELCOME_MESSAGE)];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [makeMessage("assistant", WELCOME_MESSAGE)];
    return parsed
      .filter((msg) => msg && (msg.role === "assistant" || msg.role === "user") && msg.text)
      .map((msg) => ({ ...msg, text: sanitizeAssistantText(String(msg.text)) }));
  } catch {
    return [makeMessage("assistant", WELCOME_MESSAGE)];
  }
}

function saveMessages(sessionId: string | null, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(storageKey(sessionId), JSON.stringify(messages.slice(-60)));
}

function draftKey(sessionId: string | null): string {
  return `lexrex.assistant.draft.${sessionId || "no-session"}`;
}

function userFriendlyError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value || "");
  if (
    !text ||
    /stack trace|ollama|endpoint|api payload|servicekey|bearer|raw exception/i.test(text)
  ) {
    return "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return text;
}

function sanitizeAssistantText(value: string): string {
  if (!value) return "";
  if (/OLLAMA|stack trace|API payload|serviceKey|bearer|endpoint|model|파싱 실패|파싱에 실패|기본 판정|판정 생성 실패|AI 판정 원문/i.test(value)) {
    return "현재 검토 내용을 설명하는 중 일부 정보를 정리하지 못했습니다. 핵심 쟁점은 계약서, 정산 증빙, 개인정보 처리 문서를 순서대로 확인하는 것입니다.";
  }
  return value;
}

function fromServerMessage(item: ServerMessage): ChatMessage | null {
  const text = sanitizeAssistantText(String(item.message || item.content || "").trim());
  if (!text) return null;
  const role = String(item.role || "").toLowerCase() === "user" ? "user" : "assistant";
  return {
    id: `server-${item.id || item.messageOrder || item.createdAt || Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function normalizeServerMessages(items: ServerMessage[] | undefined): ChatMessage[] {
  const rows = (items || []).map(fromServerMessage).filter(Boolean) as ChatMessage[];
  return rows.length > 0 ? rows : [makeMessage("assistant", WELCOME_MESSAGE)];
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => getCurrentSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(getCurrentSessionId()));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const loadServerHistory = async (targetSessionId: string | null) => {
    if (!targetSessionId) {
      setMessages(loadMessages(null));
      return;
    }
    setMessages(loadMessages(targetSessionId));
    setHistoryLoading(true);
    setError("");
    try {
      const res = await fetch(`http://localhost:8080/api/sessions/${targetSessionId}/assistant/messages`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "비서 상담 기록을 불러오지 못했습니다.");
      }
      const serverMessages = normalizeServerMessages(data?.messages);
      setMessages(serverMessages);
      saveMessages(targetSessionId, serverMessages);
    } catch (err) {
      setMessages(loadMessages(targetSessionId));
      setError(userFriendlyError(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const current = getCurrentSessionId();
    setSessionId(current);
    setMessages(loadMessages(current));
    setInput(typeof window === "undefined" ? "" : sessionStorage.getItem(draftKey(current)) || "");
    setError("");
    void loadServerHistory(current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      const current = getCurrentSessionId();
      if (current === sessionId) return;
      setSessionId(current);
      setMessages(loadMessages(current));
      setInput(sessionStorage.getItem(draftKey(current)) || "");
      setError("");
      void loadServerHistory(current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [open, sessionId]);

  useEffect(() => {
    saveMessages(sessionId, messages);
  }, [messages, sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (input.trim()) {
      sessionStorage.setItem(draftKey(sessionId), input);
    } else {
      sessionStorage.removeItem(draftKey(sessionId));
    }
  }, [input, sessionId]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const currentSessionId = getCurrentSessionId();
    setSessionId(currentSessionId);
    setError("");
    const clientRequestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    if (!currentSessionId) {
      setMessages((prev) => [
        ...prev,
        makeMessage("user", trimmed),
        makeMessage("assistant", "현재 검토 세션을 찾을 수 없습니다. 검토를 시작한 뒤 다시 질문해 주세요."),
      ]);
      setInput("");
      return;
    }

    const userMessage = makeMessage("user", trimmed);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`http://localhost:8080/api/sessions/${currentSessionId}/assistant/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, clientRequestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (Array.isArray(data?.messages)) {
        const serverMessages = normalizeServerMessages(data.messages);
        setMessages(serverMessages);
        saveMessages(currentSessionId, serverMessages);
        return;
      }
      const answer =
        typeof data?.message === "string" && data.message.trim()
          ? sanitizeAssistantText(data.message.trim())
          : "현재 검토 내용을 설명하는 중 문제가 발생했습니다. 잠시 후 다시 질문해 주세요.";
      setMessages((prev) => [...prev, makeMessage("assistant", answer)]);
    } catch (err) {
      const friendly = userFriendlyError(err);
      setError(friendly);
      setMessages((prev) => [...prev, makeMessage("assistant", friendly)]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) void sendMessage(input);
  };

  return (
    <>
      <button
        type="button"
        aria-label="비서 에이전트 열기"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#1E3A8A] text-white shadow-lg transition-transform hover:scale-105"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-4 z-40 flex max-h-[76vh] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:right-6"
          role="dialog"
          aria-label="비서 에이전트"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#1E3A8A] px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 shrink-0" />
                <h2 className="truncate text-sm font-semibold">비서 에이전트</h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-white/80">
                현재 검토 내용을 바탕으로 쉽게 설명해드립니다.
              </p>
            </div>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
                    msg.role === "user"
                      ? "rounded-br-sm bg-[#1E3A8A] text-white"
                      : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {historyLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  상담 기록을 불러오고 있습니다.
                </div>
              </div>
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  답변을 정리하고 있습니다.
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {RECOMMENDED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={loading}
                  onClick={() => void sendMessage(question)}
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:border-[#1E3A8A]/40 hover:bg-[#1E3A8A]/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="궁금한 내용을 입력하세요"
                rows={2}
                maxLength={1200}
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-[#1E3A8A] focus:ring-2 focus:ring-[#1E3A8A]/10"
              />
              <Button
                type="button"
                size="icon"
                disabled={!canSend}
                onClick={() => void sendMessage(input)}
                aria-label="전송"
                className="h-11 w-11 shrink-0 bg-[#1E3A8A] hover:bg-[#1E3A8A]/90"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              현재 검토 내용을 바탕으로 답변합니다. 법률 전문가의 자문을 대체하지 않습니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
