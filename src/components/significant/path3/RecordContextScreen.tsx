import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { db } from "../../../db";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function RecordContextScreen({ workflowState, updateState, onNext }: Props) {
  const [depth, setDepth] = React.useState(workflowState.depthCm != null ? String(workflowState.depthCm) : "");
  const [orientation, setOrientation] = React.useState(workflowState.orientationNotes ?? "");
  const [soil, setSoil] = React.useState(workflowState.soilObservations ?? "");
  const [associated, setAssociated] = React.useState(workflowState.preExcavationNotes ?? "");

  async function handleContinue() {
    const depthNum = depth.trim() ? parseFloat(depth) : null;
    const patch: Partial<WorkflowState> = {
      depthCm: isNaN(depthNum as number) ? null : depthNum,
      orientationNotes: orientation,
      soilObservations: soil,
      preExcavationNotes: associated,
    };
    updateState(patch);

    const findId = workflowState.linkedFindId;
    if (findId && patch.depthCm != null) {
      await db.finds.update(findId, { depthCm: patch.depthCm });
    }

    if (workflowState.significantFindId) {
      await db.significantFinds.update(workflowState.significantFindId, {
        depthCm: patch.depthCm ?? undefined,
        orientationNotes: orientation || undefined,
        soilObservations: soil,
        preExcavationNotes: associated,
        updatedAt: new Date().toISOString(),
      });
    }

    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">📍</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          The context of a find is as important as the find itself. Record what you can while it's fresh.
        </p>
      </div>

      {/* Depth */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Depth recovered <span className="font-normal text-gray-400">(cm)</span>
        </label>
        <div className="relative">
          <input
            type="number"
            value={depth}
            onChange={e => setDepth(e.target.value)}
            placeholder="e.g. 18"
            min="0"
            max="200"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 pr-12 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">cm</span>
        </div>
      </div>

      {/* Orientation */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Orientation in the ground <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={orientation}
          onChange={e => setOrientation(e.target.value)}
          placeholder="e.g. face up, pointing roughly north — flat and level in the soil…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
        />
        <p className="text-xs text-gray-400">Which way was it facing? Was it flat, upright, or angled? Any patterning to how objects were arranged?</p>
      </div>

      {/* Soil */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Soil profile in the recovery hole <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={soil}
          onChange={e => setSoil(e.target.value)}
          rows={2}
          placeholder="e.g. dark black layer at 15–20cm over natural orange clay — slight greenish staining around the objects…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
        />
        <p className="text-xs text-gray-400">Dark layer over natural? Any staining that could indicate organic material? Change in texture?</p>
      </div>

      {/* Associated material */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Any associated material in the hole? <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={associated}
          onChange={e => setAssociated(e.target.value)}
          placeholder="e.g. small pottery sherds, iron fragments, charcoal flecks…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
        />
      </div>

      <button
        onClick={handleContinue}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        Saved — describe the find →
      </button>
    </div>
  );
}
