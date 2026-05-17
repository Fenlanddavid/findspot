import React, { useCallback, useState } from "react";
import { Modal } from "./Modal";

type ConfirmOptions = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => (
    new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    })
  ), []);

  const close = useCallback((confirmed: boolean) => {
    setPending(current => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const dialog = pending ? (
    <Modal title={pending.title} onClose={() => close(false)}>
      <div className="grid gap-4">
        <div className="whitespace-pre-line text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {pending.message}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => close(false)}
            className="min-h-11 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`min-h-11 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors ${
              pending.danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, dialog };
}
