import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { db } from "../../../db";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function DescribeFindScreen({ workflowState, updateState, onNext }: Props) {
  const [title, setTitle] = React.useState(workflowState.findDescription ?? "");
  const [account, setAccount] = React.useState(workflowState.firstPersonAccount ?? "");

  async function saveToDb(patch: { findDescription?: string; firstPersonAccount?: string }) {
    if (workflowState.significantFindId) {
      await db.significantFinds.update(workflowState.significantFindId, {
        ...patch,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function handleContinue() {
    const trimmedTitle = title.trim();
    const trimmedAccount = account.trim();
    updateState({ findDescription: trimmedTitle, firstPersonAccount: trimmedAccount });
    await saveToDb({ findDescription: trimmedTitle || undefined, firstPersonAccount: trimmedAccount || undefined });
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">💬</div>
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-1">
          Name and describe it
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          A name for the record, then what you can see — the more detail the better.
        </p>
      </div>

      {/* Title */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-black text-gray-900 dark:text-gray-100">
          What is it? <span className="font-normal text-gray-400 text-xs">— becomes the record title</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim();
            updateState({ findDescription: t });
            saveToDb({ findDescription: t || undefined });
          }}
          placeholder="e.g. Roman silver denarius, medieval gilt brooch…"
          autoFocus
          className="w-full rounded-xl border-2 border-amber-400 bg-white dark:bg-gray-900 px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
        />
      </div>

      {/* Free-text description */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Describe it in your own words <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={account}
          onChange={e => setAccount(e.target.value)}
          onBlur={() => {
            const t = account.trim();
            updateState({ firstPersonAccount: t });
            saveToDb({ firstPersonAccount: t || undefined });
          }}
          rows={5}
          placeholder="It came up as a disc about 35mm across, copper alloy, with what looks like a worn face on one side and some kind of animal reverse. The patina looks quite old — smooth dark green overall. Could be a Roman coin but larger than usual, possibly a sestertius…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400 leading-relaxed"
        />
      </div>

      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3 flex items-start gap-2">
        <span className="text-base shrink-0 mt-0.5">🌍</span>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Your landscape analysis for this location has been automatically saved to this record.
        </p>
      </div>

      <button
        onClick={handleContinue}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        {title.trim() ? "Described — what next →" : "Skip for now →"}
      </button>
    </div>
  );
}
