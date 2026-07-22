import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { saveSignificantFindProgress } from "../../../services/significantFindMutations";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function DepthContextScreen({ workflowState, updateState, onNext }: Props) {
  const [depth, setDepth] = React.useState(workflowState.depthCm != null ? String(workflowState.depthCm) : "");
  const [spread, setSpread] = React.useState(workflowState.preExcavationNotes ?? "");
  const [period, setPeriod] = React.useState(workflowState.periodEstimate ?? "");
  const [associated, setAssociated] = React.useState(workflowState.soilObservations ?? "");

  async function handleContinue() {
    const depthNum = depth.trim() ? parseFloat(depth) : null;

    const patch: Partial<WorkflowState> = {
      depthCm: isNaN(depthNum as number) ? null : depthNum,
      periodEstimate: period,
      preExcavationNotes: spread,
      soilObservations: associated,
    };
    updateState(patch);

    if (workflowState.significantFindId) {
      await saveSignificantFindProgress(workflowState.significantFindId, {
        depthCm: patch.depthCm ?? undefined,
        periodEstimate: period || undefined,
        preExcavationNotes: spread,
        soilObservations: associated,
      });
    }

    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">📋</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Record what you can while it's fresh. This context can never be recovered later.
        </p>
      </div>

      {/* Depth */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Depth of deposit <span className="font-normal text-gray-400">(cm, approximate)</span>
        </label>
        <div className="relative">
          <input
            type="number"
            value={depth}
            onChange={e => setDepth(e.target.value)}
            placeholder="e.g. 25"
            min="0"
            max="500"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 pr-12 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">cm</span>
        </div>
      </div>

      {/* Spread */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Approximate spread of deposit <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={spread}
          onChange={e => setSpread(e.target.value)}
          placeholder="e.g. tight cluster within 30cm, spread over roughly 1m…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
        />
      </div>

      {/* Period estimate */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          What period do you think this might be, and why? <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={period}
          onChange={e => setPeriod(e.target.value)}
          rows={2}
          placeholder="e.g. Roman — the coins visible look like late 3rd century bronze, similar to ones found nearby last season…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
        />
        <p className="text-xs text-gray-400">Not for classification — just for the record. Your guess is valuable.</p>
      </div>

      {/* Associated finds */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Any associated finds already in hand? <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={associated}
          onChange={e => setAssociated(e.target.value)}
          rows={2}
          placeholder="e.g. 3 coins already recovered before stopping, iron knife fragment found nearby…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
        />
      </div>

      <button
        onClick={handleContinue}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        Saved — describe what happened →
      </button>
    </div>
  );
}
