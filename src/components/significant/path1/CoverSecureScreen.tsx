import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { saveSignificantFindProgress } from "../../../services/significantFindMutations";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

const FIND_TYPES = [
  "Roman coin hoard",
  "Bronze Age metalwork hoard",
  "Iron Age coin hoard",
  "Medieval coin hoard",
  "Viking Age metalwork",
  "Post-medieval coins",
  "Single significant artefact",
  "Other",
];

const CHECKLIST = [
  { id: "soil", label: "Replaced the loose soil over the deposit" },
  { id: "marked", label: "Marked the spot visibly (stick, flag, or marker)" },
  { id: "stopped", label: "No further digging or disturbance by anyone" },
];

export default function CoverSecureScreen({ workflowState, updateState, onNext }: Props) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [coverNote, setCoverNote] = React.useState("");
  const [findDesc, setFindDesc] = React.useState(workflowState.findDescription ?? "");
  const [showOtherInput, setShowOtherInput] = React.useState(
    !!workflowState.findDescription && !FIND_TYPES.slice(0, -1).includes(workflowState.findDescription)
  );

  const allChecked = CHECKLIST.every(item => checked[item.id]);

  function toggle(id: string) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function selectFindType(type: string) {
    if (type === "Other") {
      setShowOtherInput(true);
      return;
    }
    setShowOtherInput(false);
    setFindDesc(type);
    updateState({ findDescription: type });
    if (workflowState.significantFindId) {
      await saveSignificantFindProgress(workflowState.significantFindId, {
        findDescription: type,
      });
    }
  }

  async function saveOtherDesc(value: string) {
    setFindDesc(value);
    updateState({ findDescription: value });
    if (workflowState.significantFindId && value.trim()) {
      await saveSignificantFindProgress(workflowState.significantFindId, {
        findDescription: value,
      });
    }
  }

  async function handleContinue() {
    updateState({ secureCoverNotes: coverNote });
    if (workflowState.significantFindId) {
      await saveSignificantFindProgress(workflowState.significantFindId, {
        secureCoverNotes: coverNote || undefined,
      });
    }
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">🛡️</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Secure the area before making any calls. Replacing the soil protects the deposit and the spatial context.
        </p>
      </div>

      {/* Checklist */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">Confirm:</p>
        {CHECKLIST.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
              checked[item.id]
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700"
                : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
            }`}
          >
            <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
              checked[item.id]
                ? "bg-emerald-500 border-emerald-500"
                : "border-gray-300 dark:border-gray-600"
            }`}>
              {checked[item.id] && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
          </button>
        ))}
      </div>

      {/* What was used to cover */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          What did you use to cover it? <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={coverNote}
          onChange={e => setCoverNote(e.target.value)}
          placeholder="e.g. loose soil replaced, marker flag, piece of turf…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
        />
      </div>

      {/* Find type */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
          What type of find is this? <span className="font-normal text-gray-400">(optional)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {FIND_TYPES.map(type => {
            const isSelected = type === "Other" ? showOtherInput : findDesc === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => selectFindType(type)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  isSelected
                    ? "bg-amber-500 border-amber-500 text-white"
                    : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-amber-400"
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>
        {showOtherInput && (
          <input
            type="text"
            value={showOtherInput && !FIND_TYPES.slice(0, -1).includes(findDesc) ? findDesc : ""}
            onChange={e => saveOtherDesc(e.target.value)}
            placeholder="Describe the find type…"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20"
          />
        )}
      </div>

      <button
        onClick={handleContinue}
        disabled={!allChecked}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-40 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        Secured — record the details →
      </button>
    </div>
  );
}
