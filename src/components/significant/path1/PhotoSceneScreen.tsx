import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { db } from "../../../db";
import { fileToBlob } from "../../../services/photos";
import { v4 as uuid } from "uuid";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

type PhotoSlot = {
  id: string;
  label: string;
  why: string;
  instruction: string;
  required: boolean;
};

const SLOTS: PhotoSlot[] = [
  {
    id: "ground_surface",
    label: "Ground surface — before anything moves",
    why: "This is the only photo professionals cannot reconstruct later. Once the ground is disturbed, the spatial relationship between objects is gone forever. Even an archaeologist cannot undo this — you are the only person who will ever see it like this.",
    instruction: "Step back 1–2 metres. Photograph the area as it is right now — include the hole, any visible objects, and the immediate surrounding ground. Don't move anything first.",
    required: true,
  },
  {
    id: "in_situ",
    label: "Objects in the ground",
    why: "If anything is still partly buried or touching other material, this shot tells the story of how objects were deposited. Even a blurry photo at depth is more useful than none — it shows orientation, association, and depth layer.",
    instruction: "Photograph looking down into the hole. Capture objects in their position relative to each other and the soil. If nothing is visible below the surface, skip this shot.",
    required: false,
  },
  {
    id: "recovery_hole",
    label: "The recovery hole",
    why: "The depth, shape, and soil colour in the hole tells archaeologists about the deposit layer — whether objects came from plough soil, a feature cut, or undisturbed ground. Don't tidy it: the rawer it looks, the more informative it is.",
    instruction: "Photograph the hole as it stands. Show the walls and depth if you can. A ruler, trowel, or finger in frame gives scale — useful but not essential.",
    required: false,
  },
  {
    id: "wider_scene",
    label: "Looking back from the spot",
    why: "Landscape context — a field edge, ditch, crop change, slope, or ridge visible in this frame can be more informative to a specialist than the find itself. It tells them where in the landscape this fits.",
    instruction: "Walk 5–10 metres away. Turn and photograph back towards the spot, showing the surrounding field and any nearby features. Capture the wider environment.",
    required: false,
  },
];

export default function PhotoSceneScreen({ workflowState, updateState, onNext }: Props) {
  const [currentSlotIdx, setCurrentSlotIdx] = React.useState(0);
  const [taken, setTaken] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [savedSlot, setSavedSlot] = React.useState<string | null>(null);

  const currentSlot = SLOTS[currentSlotIdx];
  const isLastSlot = currentSlotIdx === SLOTS.length - 1;

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file || !workflowState.significantFindId || saving) return;
    setSaving(true);
    try {
      const blob = await fileToBlob(file);
      await db.media.add({
        id: uuid(),
        projectId: workflowState.projectId,
        findId: workflowState.significantFindId,
        type: "photo",
        photoType: "in-situ",
        filename: file.name,
        mime: file.type || "image/jpeg",
        blob,
        caption: currentSlot.label,
        scalePresent: false,
        createdAt: new Date().toISOString(),
      });
      setTaken(prev => ({ ...prev, [currentSlot.id]: true }));
      setSavedSlot(currentSlot.id);
      if (currentSlot.id === "ground_surface") {
        updateState({ groundSurfacePhotoCaptured: true });
        await db.significantFinds.update(workflowState.significantFindId, {
          groundSurfacePhotoCaptured: true,
          updatedAt: new Date().toISOString(),
        });
      }
      setTimeout(() => {
        setSavedSlot(null);
        if (isLastSlot) {
          onNext();
        } else {
          setCurrentSlotIdx(i => i + 1);
        }
      }, 800);
    } catch {
      // allow retry
    } finally {
      setSaving(false);
    }
  }

  function skipSlot() {
    if (isLastSlot) {
      onNext();
    } else {
      setCurrentSlotIdx(i => i + 1);
    }
  }

  const isSaved = savedSlot === currentSlot.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">📸</div>
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-1">
          {currentSlotIdx === 0
            ? "This is the most important record you'll make today."
            : currentSlot.label}
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Photo {currentSlotIdx + 1} of {SLOTS.length}
          {!currentSlot.required && (
            <span className="ml-2 text-gray-400">· optional</span>
          )}
        </p>
      </div>

      {/* Why this shot matters */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1.5">
          Why this shot matters
        </p>
        <p className="text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
          {currentSlot.why}
        </p>
      </div>

      {/* What to photograph */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">
          What to photograph
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          {currentSlot.instruction}
        </p>
      </div>

      {/* CTA */}
      {isSaved ? (
        <div className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-black uppercase tracking-widest text-sm text-center">
          ✓ Saved{isLastSlot ? " — finishing up…" : " — next shot →"}
        </div>
      ) : (
        <label className={`w-full py-4 rounded-2xl text-white font-black uppercase tracking-widest text-sm text-center cursor-pointer select-none transition-all active:scale-95 ${
          saving ? "bg-amber-400 opacity-70 pointer-events-none" : "bg-amber-600 hover:bg-amber-700"
        }`}>
          {saving ? "Saving…" : currentSlot.required ? "Take photo →" : "Take this shot →"}
          <input
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            className="hidden"
            disabled={saving}
          />
        </label>
      )}

      {/* Skip (optional slots only) */}
      {!currentSlot.required && !isSaved && !saving && (
        <button
          type="button"
          onClick={skipSlot}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {isLastSlot ? "Skip — finish photos" : "Skip this shot →"}
        </button>
      )}

      {/* Skip all (first slot only, before required photo taken) */}
      {currentSlotIdx === 0 && !taken["ground_surface"] && !isSaved && !saving && (
        <button
          type="button"
          onClick={onNext}
          className="w-full py-1.5 text-xs text-gray-300 dark:text-gray-600 hover:text-gray-500 transition-colors"
        >
          Skip all photos (not recommended)
        </button>
      )}

      {/* Progress dots */}
      <div className="flex justify-center gap-2">
        {SLOTS.map((slot, i) => (
          <div
            key={slot.id}
            className={`rounded-full transition-all duration-300 ${
              taken[slot.id]
                ? "w-2 h-2 bg-emerald-500"
                : i === currentSlotIdx
                ? "w-4 h-2 bg-amber-500"
                : "w-2 h-2 bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
