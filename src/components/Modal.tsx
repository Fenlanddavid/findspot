import React, { useEffect } from "react";

export interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  fullScreen?: boolean;
}

export default function Modal(props: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [props.onClose]);

  if (props.fullScreen) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 bg-white dark:bg-gray-950 z-[100] no-print overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
      >
        <div className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 p-4 flex justify-between items-center">
            <h2 className="m-0 text-xl font-black uppercase tracking-tight">{props.title}</h2>
            <button 
              onClick={props.onClose} 
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
      className="fixed inset-0 bg-black/45 grid place-items-center p-4 z-50 backdrop-blur-sm no-print"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-[min(720px,100%)] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl border border-gray-200 dark:border-gray-700/60 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.45)] animate-in fade-in zoom-in duration-200">
        {props.headerActions ? (
          <>
            <h2 className="m-0 mb-2 text-xl font-bold whitespace-nowrap tracking-[0.3px] opacity-50">{props.title}</h2>
            <div className="flex items-center gap-3 flex-nowrap mb-2">
              {props.headerActions}
              <button onClick={props.onClose} className="ml-auto shrink-0 p-2 rounded-xl transition-all duration-[140ms] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] active:bg-gray-200 dark:active:bg-white/[0.05] active:scale-95">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className="flex justify-between gap-2 items-start mb-4">
            <h2 className="m-0 text-xl font-bold whitespace-nowrap tracking-[0.3px] opacity-50">{props.title}</h2>
            <button onClick={props.onClose} className="shrink-0 mt-0.5 p-2 rounded-xl transition-all duration-[140ms] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] active:bg-gray-200 dark:active:bg-white/[0.05] active:scale-95">
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
