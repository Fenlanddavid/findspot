import React from "react";
import { WorkflowState } from "../../../types/significantFind";
import { fileToBlob } from "../../../services/photos";
import { v4 as uuid } from "uuid";
import {
  addSignificantFindMedia,
  createSignificantFindRecord,
} from "../../../services/significantFindMutations";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

type PhotoSlot = {
  id: string;
  label: string;
  prompt: string;
};

const SLOTS: PhotoSlot[] = [
  {
    id: "in_situ",
    label: "In situ",
    prompt: "As found in the ground, before removal if possible",
  },
  {
    id: "in_hand",
    label: "In hand with scale",
    prompt: "Hold a coin, ruler, or finger alongside for scale",
  },
  {
    id: "detail",
    label: "Close detail",
    prompt: "Markings, decoration, casting seams, any unusual features",
  },
  {
    id: "recovery_hole",
    label: "Recovery point",
    prompt: "The hole — showing the depth and what the soil looks like",
  },
];

export default function PhotoCaptureScreen({ workflowState, updateState, onNext }: Props) {
  const [taken, setTaken] = React.useState<Record<string, boolean>>({});
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);

  const hasSomePhoto = Object.values(taken).some(Boolean);
  const mediaOwnerId = workflowState.linkedFindId ?? workflowState.significantFindId;

  // Create the significantFinds record on first render if not yet created
  React.useEffect(() => {
    if (workflowState.significantFindId || creatingRef.current) return;
    creatingRef.current = true;
    const now = new Date().toISOString();
    const newId = uuid();
    createSignificantFindRecord({
      id: newId,
      projectId: workflowState.projectId,
      permissionId: workflowState.permissionId ?? "",
      sessionId: workflowState.sessionId,
      path: "notable_find",
      status: "in_progress",
      jurisdiction: workflowState.jurisdiction,
      lat: workflowState.lat,
      lon: workflowState.lon,
      gpsAccuracyM: workflowState.gpsAccuracyM,
      osGridRef: workflowState.osGridRef,
      w3w: workflowState.w3w,
      preExcavationNotes: "",
      soilObservations: "",
      secureCoverNotes: "",
      groundSurfacePhotoCaptured: false,
      scatterId: null,
      scatterFindIds: [],
      linkedFindId: workflowState.linkedFindId,
      treasureActDraft: "",
      landownerSummary: "",
      findDescription: workflowState.findDescription || undefined,
      createdAt: now,
      updatedAt: now,
    }, workflowState.linkedFindId).then(() => {
      updateState({ significantFindId: newId });
    }).catch(() => {
      creatingRef.current = false;
      setPhotoError("Could not prepare the significant-find record. Try again before taking photos.");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhoto(slotId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (!mediaOwnerId) {
      setPhotoError("Preparing the record. Wait a moment, then try the photo again.");
      return;
    }
    setPhotoError(null);
    try {
      const blob = await fileToBlob(file);
      await addSignificantFindMedia({
        id: uuid(),
        projectId: workflowState.projectId,
        findId: mediaOwnerId,
        type: "photo",
        photoType: slotId === "in_situ" ? "in-situ" : slotId === "in_hand" ? "photo1" : slotId === "detail" ? "photo2" : "photo3",
        filename: file.name,
        mime: file.type || "image/jpeg",
        blob,
        caption: SLOTS.find(s => s.id === slotId)?.label ?? slotId,
        scalePresent: slotId === "in_hand",
        createdAt: new Date().toISOString(),
      });
      setTaken(prev => ({ ...prev, [slotId]: true }));
    } catch {
      setPhotoError("Photo could not be saved. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">📸</div>
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-1">
          Photograph in sequence
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Start with the context, then move to the object. Don't tidy anything up.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {SLOTS.map((slot, idx) => (
          <label
            key={slot.id}
            className={`flex items-center gap-4 p-3 rounded-xl border cursor-pointer transition-all ${
              taken[slot.id]
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700"
                : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:border-amber-400"
            }`}
          >
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${
              taken[slot.id]
                ? "bg-emerald-500 text-white"
                : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            }`}>
              {taken[slot.id] ? "✓" : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{slot.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{slot.prompt}</p>
            </div>
            <span className="text-lg shrink-0">{taken[slot.id] ? "" : "📷"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={e => handlePhoto(slot.id, e)}
              className="hidden"
            />
          </label>
        ))}
      </div>

      <button
        onClick={onNext}
        disabled={!hasSomePhoto}
        className="w-full bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-40 text-white font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all"
      >
        {hasSomePhoto ? "Photos taken — record context →" : "Take at least one photo to continue"}
      </button>

      {photoError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {photoError}
        </p>
      )}

      {!hasSomePhoto && (
        <button type="button" onClick={onNext} className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Skip photos (not recommended)
        </button>
      )}
    </div>
  );
}
