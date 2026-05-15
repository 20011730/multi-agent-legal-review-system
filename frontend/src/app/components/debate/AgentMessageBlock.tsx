import { Badge } from "../ui/badge";
import type { DebateMessage } from "../../hooks/useDebatePolling";
import { resolveAgentPresentation } from "./agentRoleMap";

function renderBlockContent(content: string) {
  return content.split("\n").map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h4 key={idx} className="mt-2 mb-1 text-sm font-semibold text-slate-800">
          {trimmed.replace(/^##\s*/, "")}
        </h4>
      );
    }
    if (!trimmed) return <div key={idx} className="h-2" />;
    return (
      <p key={idx} className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
        {line}
      </p>
    );
  });
}

export function AgentMessageBlock({ message }: { message: DebateMessage }) {
  const agent = resolveAgentPresentation(message.agentId, message.agentName);
  const Icon = agent.icon;

  return (
    <article
      className={`rounded-xl border p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${agent.bgClass} ${agent.borderClass}`}
    >
      <header className={`flex flex-wrap items-center gap-2 text-sm font-medium ${agent.colorClass}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 shadow-sm ring-1 ring-black/5">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span>{agent.displayName}</span>
        <span className="text-xs font-normal opacity-80">({agent.subtitle})</span>
        <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wide">
          R{message.round}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {message.type}
        </Badge>
      </header>
      {message.stance ? (
        <p className="mt-1 text-xs text-slate-500">입장: {message.stance}</p>
      ) : null}
      <div className="mt-3 border-t border-black/5 pt-3">{renderBlockContent(message.content)}</div>
      {message.evidenceSummary ? (
        <p className="mt-3 text-xs italic text-slate-500">근거 요약: {message.evidenceSummary}</p>
      ) : null}
    </article>
  );
}
