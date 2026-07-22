import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { saveSignificantFindProgress } from "../../../services/significantFindMutations";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function YourAccountScreen({ workflowState, updateState, onNext }: Props) {
  const [account, setAccount] = React.useState(workflowState.firstPersonAccount ?? "");
  const [saved, setSaved] = React.useState(true);

  React.useEffect(() => {
    setSaved(account === (workflowState.firstPersonAccount ?? ""));
  }, [account, workflowState.firstPersonAccount]);

  async function save() {
    updateState({ firstPersonAccount: account });
    if (workflowState.significantFindId) {
      await saveSignificantFindProgress(workflowState.significantFindId, {
        firstPersonAccount: account,
      });
    }
    setSaved(true);
  }

  async function handleContinue() {
    if (!saved) await save();
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">🗣️</div>
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-1">
          Your account of the discovery
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Describe what happened — what signal you got, how you started digging, what you found and in what order.
        </p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed italic">
          "Your own words, in your own time. This first-person account is often the most useful thing a professional receives. It documents the sequence of discovery — something that can never be reconstructed later."
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={account}
          onChange={e => setAccount(e.target.value)}
          onBlur={() => { if (!saved) save(); }}
          rows={6}
          placeholder="I was detecting the field corner when I got a strong signal around 15cm. I started digging and about 10cm down found what looked like a bronze edge. I could see more objects below it, close together, so I stopped immediately and replaced the soil…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400 leading-relaxed"
        />
        {!saved && (
          <button
            type="button"
            onClick={save}
            className="self-end px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-black uppercase tracking-wide"
          >
            Save
          </button>
        )}
        {saved && account.trim() && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 text-right">✓ Saved</p>
        )}
      </div>

      <button
        onClick={handleContinue}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        {account.trim() ? "Done — what next →" : "Skip for now →"}
      </button>
    </div>
  );
}
