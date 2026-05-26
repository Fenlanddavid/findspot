import React from "react";
import { WorkflowState } from "../../../types/significantFind";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
  onSwitchToInsitu: () => void;
};

export default function ScatterConfirmScreen({ workflowState, updateState, onNext, onSwitchToInsitu }: Props) {
  const [description, setDescription] = React.useState(workflowState.findDescription ?? "");

  function handleConfirm() {
    if (description.trim()) {
      updateState({ findDescription: description.trim() });
    }
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">🗺️</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Before we start logging the scatter, let's confirm this is truly dispersed material.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-black text-gray-900 dark:text-gray-100">
          What type of material is this?
        </label>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. Roman coins, medieval hammered silver…"
          autoFocus
          className="w-full rounded-xl border-2 border-amber-400 bg-white dark:bg-gray-900 px-3 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
        />
        <p className="text-xs text-gray-500">Becomes the record title — you can edit it after.</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleConfirm}
          className="text-left w-full rounded-2xl border border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/5 p-4 transition-all active:scale-[0.98]"
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-lg">🟡</div>
            <div>
              <p className="font-black text-sm text-gray-900 dark:text-gray-100">Yes — clearly spread across an area</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 leading-relaxed">
                Finds are well spread out (10+ metres), clearly moved by ploughing. Nothing appears to be in original context. I'm confident this is a dispersed scatter.
              </p>
            </div>
            <svg className="shrink-0 self-center text-gray-400 ml-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </button>

        <button
          onClick={onSwitchToInsitu}
          className="text-left w-full rounded-2xl border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/5 p-4 transition-all active:scale-[0.98]"
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-lg">🔴</div>
            <div>
              <p className="font-black text-sm text-gray-900 dark:text-gray-100">Actually, they might be in-situ</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 leading-relaxed">
                Finds are close together, or I'm not sure if there's undisturbed material below. Treat it as in situ — the safe choice.
              </p>
            </div>
            <svg className="shrink-0 self-center text-gray-400 ml-auto" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </button>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          <span className="font-semibold">Rule of thumb:</span> If everything is within a few metres of each other, or if you haven't dug down yet and can't see the full picture — switch to Stop &amp; Secure. When in doubt, treat it as in situ.
        </p>
      </div>
    </div>
  );
}
