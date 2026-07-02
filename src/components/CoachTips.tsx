import React, { useEffect, useState } from "react";

export type CoachTip = {
  title: string;
  body: string;
  accent: string;
  border: string;
  position: string;
  button?: string;
  action?: () => void;
};

export function CoachTips({
  storageKey,
  tips,
  enabled = true,
  forceShow = false,
  mobileInline = false,
  onDismiss,
  onStepChange,
}: {
  storageKey: string;
  tips: CoachTip[];
  enabled?: boolean;
  forceShow?: boolean;
  mobileInline?: boolean;
  onDismiss?: () => void;
  onStepChange?: (index: number) => void;
}) {
  const [visible, setVisible] = useState(() => {
    if ((!enabled && !forceShow) || tips.length === 0) return false;
    if (forceShow) return true;
    try { return localStorage.getItem(storageKey) !== "1"; } catch { return true; }
  });
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if ((!enabled && !forceShow) || tips.length === 0) {
      setVisible(false);
      return;
    }
    if (forceShow) {
      setStepIndex(0);
      setVisible(true);
      return;
    }
    try { setVisible(localStorage.getItem(storageKey) !== "1"); } catch { setVisible(true); }
  }, [enabled, forceShow, storageKey, tips.length]);

  useEffect(() => {
    if (visible) onStepChange?.(stepIndex);
    // onStepChange is an inline callback — excluded from deps to avoid firing on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stepIndex]);

  if (!visible || tips.length === 0) return null;

  const tip = tips[Math.min(stepIndex, tips.length - 1)];
  const dismiss = () => {
    try { localStorage.setItem(storageKey, "1"); } catch {}
    setStepIndex(0);
    setVisible(false);
    onDismiss?.();
  };

  const card = (className: string) => (
      <div className={`${className} rounded-xl border ${tip.border} bg-black/95 p-2.5 shadow-2xl pointer-events-auto`}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className={`text-[8px] font-black uppercase tracking-[0.18em] ${tip.accent}`}>{tip.title}</p>
            <p className="mt-1 text-[10px] font-bold leading-snug text-white/85">{tip.body}</p>
          </div>
          <span className="shrink-0 rounded-lg border border-white/10 px-1.5 py-0.5 text-[8px] font-black text-white/45">
            {stepIndex + 1}/{tips.length}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={dismiss}
            className="rounded-lg px-1.5 py-1.5 text-[8px] font-black uppercase tracking-widest text-white/40 transition-colors hover:text-white/70"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex(i => Math.max(0, i - 1))}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/65 transition-colors hover:text-white"
              >
                Back
              </button>
            )}
            {stepIndex < tips.length - 1 ? (
              <>
                {tip.action && tip.button && (
                  <button
                    onClick={tip.action}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white/70 transition-colors hover:text-white"
                  >
                    {tip.button}
                  </button>
                )}
                <button
                  onClick={() => setStepIndex(i => Math.min(tips.length - 1, i + 1))}
                  className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-400"
                >
                  Next
                </button>
              </>
            ) : (
              <button
                onClick={dismiss}
                className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-400"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
  );

  if (mobileInline) {
    return (
      <>
        <div className="relative z-20 mb-4 pointer-events-none sm:hidden">
          {card("w-full")}
        </div>
        <div className="hidden sm:block fixed inset-0 z-[220] pointer-events-none">
          {card(`absolute ${tip.position}`)}
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[220] pointer-events-none">
      {card(`absolute ${tip.position}`)}
    </div>
  );
}
