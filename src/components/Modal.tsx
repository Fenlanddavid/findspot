import React, { useEffect, useId, useRef } from "react";

export interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  fullScreen?: boolean;
}

export default function Modal(props: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    const focusFirstElement = () => {
      const focusable = Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter(el => !el.hasAttribute("disabled") && el.offsetParent !== null);
      (focusable[0] ?? panel)?.focus();
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
        return;
      }

      if (e.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(el => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const timer = window.setTimeout(focusFirstElement, 0);
    document.addEventListener("keydown", handler);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handler);
      previousActive?.focus();
    };
  }, [props.onClose]);

  if (props.fullScreen) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 bg-white dark:bg-gray-950 z-[120] no-print overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 p-4 flex justify-between items-center">
            <h2 id={titleId} className="m-0 text-xl font-black uppercase tracking-tight">{props.title}</h2>
            <button 
              onClick={props.onClose} 
              aria-label="Close dialog"
              className="p-2 bg-gray-100 dark:bg-gray-800 hover:bg-red-500 hover:text-white rounded-full transition-all text-gray-500 shadow-sm"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
        </div>
        <div className="p-6">{props.children}</div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/45 grid place-items-center p-4 z-[120] backdrop-blur-sm no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="w-[min(720px,100%)] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl border border-gray-200 dark:border-gray-700/60 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.45)] animate-in fade-in zoom-in duration-200 outline-none">
        {props.headerActions ? (
          <>
            <div className="flex justify-between items-center gap-2 mb-2">
              <h2 id={titleId} className="m-0 text-xl font-bold tracking-[0.3px] text-gray-700 dark:text-gray-200 truncate">{props.title}</h2>
              <button onClick={props.onClose} aria-label="Close dialog" className="shrink-0 p-2 rounded-xl transition-all duration-[140ms] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] active:bg-gray-200 dark:active:bg-white/[0.05] active:scale-95">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-3 flex-nowrap mb-2">
              {props.headerActions}
            </div>
          </>
        ) : (
          <div className="flex justify-between gap-2 items-start mb-4">
            <h2 id={titleId} className="m-0 text-xl font-bold tracking-[0.3px] text-gray-700 dark:text-gray-200 break-words">{props.title}</h2>
            <button onClick={props.onClose} aria-label="Close dialog" className="shrink-0 mt-0.5 p-2 rounded-xl transition-all duration-[140ms] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] active:bg-gray-200 dark:active:bg-white/[0.05] active:scale-95">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
        <div className="h-px mb-3" style={{ background: 'rgba(255,255,255,0.06)', opacity: 0.6 }} />
        <div>{props.children}</div>
      </div>
    </div>
  );
}

export { Modal };
