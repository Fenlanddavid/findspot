import React from "react";

export function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-black/45 grid place-items-center p-4 z-50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-[min(720px,100%)] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex justify-between gap-3 items-center mb-3">
          <h2 className="m-0 text-xl font-bold">{props.title}</h2>
          <button onClick={props.onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">✕</button>
        </div>
        <div className="mt-3">{props.children}</div>
      </div>
    </div>
  );
}
