import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { v4 as uuid } from "uuid";
import {
  createSignificantFindRecord,
  saveSignificantFindProgress,
} from "../../../services/significantFindMutations";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

type ObsToggle = { id: string; label: string };

const OBS_PROMPTS: ObsToggle[] = [
  { id: "still_in_ground", label: "Objects still in the ground" },
  { id: "touching", label: "Objects touching or very close together" },
  { id: "container", label: "Pottery, organic staining, or stone setting visible" },
  { id: "cluster", label: "A distinct cluster rather than a spread" },
];

export default function ObserveScreen({ workflowState, updateState, onNext }: Props) {
  const [toggles, setToggles] = React.useState<Record<string, boolean>>({});
  const [notes, setNotes] = React.useState(workflowState.initialObservations ?? "");
  const [creating, setCreating] = React.useState(false);

  function toggle(id: string) {
    setToggles(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleContinue() {
    if (creating) return;
    setCreating(true);

    const obsText = [
      ...OBS_PROMPTS.filter(p => toggles[p.id]).map(p => `• ${p.label}`),
      notes.trim() ? notes.trim() : "",
    ].filter(Boolean).join("\n");

    updateState({ initialObservations: obsText || notes });

    // Create the SignificantFind record immediately so it survives app kills
    let sfId = workflowState.significantFindId;
    if (!sfId) {
      sfId = uuid();
      const now = new Date().toISOString();
      await createSignificantFindRecord({
        id: sfId,
        projectId: workflowState.projectId,
        permissionId: workflowState.permissionId ?? "",
        sessionId: workflowState.sessionId,
        path: "stop_secure",
        status: "in_progress",
        jurisdiction: workflowState.jurisdiction,
        lat: workflowState.lat,
        lon: workflowState.lon,
        gpsAccuracyM: workflowState.gpsAccuracyM,
        osGridRef: workflowState.osGridRef,
        w3w: workflowState.w3w,
        initialObservations: obsText || notes,
        preExcavationNotes: "",
        soilObservations: "",
        secureCoverNotes: "",
        groundSurfacePhotoCaptured: false,
        scatterId: null,
        scatterFindIds: [],
        linkedFindId: null,
        treasureActDraft: "",
        landownerSummary: "",
        createdAt: now,
        updatedAt: now,
      });
      updateState({ significantFindId: sfId });
    } else {
      await saveSignificantFindProgress(sfId, {
        initialObservations: obsText || notes,
      });
    }

    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-3">🔍</div>
        <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 leading-tight mb-2">
          Let's make sure this find is recorded properly.
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          The next few minutes matter more than the next few hours. Everything we capture now can't be recovered later.
        </p>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
        <p className="text-sm font-bold text-amber-900 dark:text-amber-200 mb-1">Before touching anything else</p>
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
          Look at what you have. Take a moment. What can you observe without disturbing it further?
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">What can you see?</p>
        {OBS_PROMPTS.map(prompt => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => toggle(prompt.id)}
            className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
              toggles[prompt.id]
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700"
                : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
            }`}
          >
            <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
              toggles[prompt.id]
                ? "bg-emerald-500 border-emerald-500"
                : "border-gray-300 dark:border-gray-600"
            }`}>
              {toggles[prompt.id] && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300">{prompt.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Anything else? <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Describe what you can see without moving anything — depth of deposit, number of visible objects, any unusual features…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
        />
      </div>

      <button
        onClick={handleContinue}
        disabled={creating}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-60 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        {creating ? "Saving…" : "Observed — photograph the scene →"}
      </button>
    </div>
  );
}
