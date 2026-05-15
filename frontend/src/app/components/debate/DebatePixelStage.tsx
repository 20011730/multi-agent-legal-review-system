/**
 * 토론 진행 중(로딩·에이전트 교대) 상단에 표시하는 픽셀 스타일 로딩 무대.
 */
export function DebatePixelStage({ label }: { label: string }) {
  const cells = 48;
  return (
    <div className="rounded-2xl border border-[#1E3A8A]/20 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#1E3A8A]/80">Live agents</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{label}</p>
        </div>
        <div
          className="grid w-full max-w-[220px] grid-cols-12 gap-0.5 md:max-w-[260px]"
          aria-hidden
        >
          {Array.from({ length: cells }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-[1px] bg-[#1E3A8A] opacity-20 motion-safe:animate-[pixelPulse_1.4s_ease-in-out_infinite]"
              style={{
                animationDelay: `${(i % 12) * 90 + Math.floor(i / 12) * 40}ms`,
              }}
            />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes pixelPulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
