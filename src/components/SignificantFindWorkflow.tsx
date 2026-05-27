import React from "react";
import { WorkflowState, WorkflowStep, WorkflowPath } from "../types/significantFind";
import BranchScreen from "./significant/BranchScreen";

// Path 1 — Secure Find
import ObserveScreen from "./significant/path1/ObserveScreen";
import PhotoSceneScreen from "./significant/path1/PhotoSceneScreen";
import MarkSpotScreen from "./significant/path1/MarkSpotScreen";
import CoverSecureScreen from "./significant/path1/CoverSecureScreen";
import DepthContextScreen from "./significant/path1/DepthContextScreen";
import YourAccountScreen from "./significant/path1/YourAccountScreen";
import WhatNextScreen from "./significant/path1/WhatNextScreen";

// Path 2 — Map Scatter
import ScatterConfirmScreen from "./significant/path2/ScatterConfirmScreen";
import ScatterRecordingScreen from "./significant/path2/ScatterRecordingScreen";
import ScatterCompleteScreen from "./significant/path2/ScatterCompleteScreen";

// Path 3 — Notable Find
import PhotoCaptureScreen from "./significant/path3/PhotoCaptureScreen";
import RecordContextScreen from "./significant/path3/RecordContextScreen";
import DescribeFindScreen from "./significant/path3/DescribeFindScreen";
import FindWhatNextScreen from "./significant/path3/FindWhatNextScreen";

type Props = {
  isOpen: boolean;
  workflowState: WorkflowState;
  onClose: () => void;
  updateState: (patch: Partial<WorkflowState>) => void;
  goToStep: (step: WorkflowStep) => void;
  setPath: (path: WorkflowPath) => void;
};

const PATH_LABELS: Record<NonNullable<WorkflowPath>, string> = {
  stop_secure: "Stop & Secure",
  map_scatter: "Map Scatter",
  notable_find: "Notable Find",
};

const PATH_STEP_ORDER: Record<NonNullable<WorkflowPath>, WorkflowStep[]> = {
  stop_secure: ["observe", "photo_scene", "mark_spot", "cover_secure", "depth_context", "your_account", "what_next"],
  map_scatter: ["scatter_confirm", "scatter_recording", "scatter_complete"],
  notable_find: ["photo_capture", "mark_spot", "record_context", "describe_find", "find_what_next"],
};

function getStepIndex(path: WorkflowPath, step: WorkflowStep): number {
  if (!path || step === "branch") return -1;
  return PATH_STEP_ORDER[path].indexOf(step);
}

export default function SignificantFindWorkflow({ isOpen, workflowState, onClose, updateState, goToStep, setPath }: Props) {
  if (!isOpen) return null;

  const { currentStep, path } = workflowState;
  const steps = path ? PATH_STEP_ORDER[path] : [];
  const currentIdx = getStepIndex(path, currentStep);
  const totalSteps = steps.length;

  function handleSelectPath(selectedPath: WorkflowPath) {
    if (!selectedPath) return;
    setPath(selectedPath);
    goToStep(PATH_STEP_ORDER[selectedPath][0]);
  }

  function goNext() {
    if (!path) return;
    const idx = getStepIndex(path, currentStep);
    const next = PATH_STEP_ORDER[path][idx + 1];
    if (next) goToStep(next);
  }

  function goBack() {
    if (currentStep === "branch") { onClose(); return; }
    if (!path) return;
    const idx = getStepIndex(path, currentStep);
    if (idx <= 0) { goToStep("branch"); return; }
    goToStep(PATH_STEP_ORDER[path][idx - 1]);
  }

  const title = currentStep === "branch"
    ? "Significant Find"
    : path ? PATH_LABELS[path] : "Significant Find";

  const commonProps = { workflowState, updateState, onNext: goNext, onClose };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 bg-white dark:bg-gray-950 z-[230] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      {/* Header */}
      <div className="shrink-0 sticky top-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={goBack}
            aria-label="Back"
            className="shrink-0 p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-black uppercase tracking-tight truncate">{title}</h2>
            {path && currentStep !== "branch" && totalSteps > 1 && (
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                Step {currentIdx + 1} of {totalSteps}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        {/* Progress bar */}
        {path && currentStep !== "branch" && totalSteps > 1 && (
          <div className="h-0.5 bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${((currentIdx + 1) / totalSteps) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 pb-8 max-w-xl mx-auto w-full">
          {currentStep === "branch" && <BranchScreen workflowState={workflowState} onSelect={handleSelectPath} />}

          {/* Path 1 — Secure Find */}
          {currentStep === "observe" && <ObserveScreen {...commonProps} />}
          {currentStep === "photo_scene" && <PhotoSceneScreen {...commonProps} />}
          {currentStep === "mark_spot" && <MarkSpotScreen {...commonProps} />}
          {currentStep === "cover_secure" && <CoverSecureScreen {...commonProps} />}
          {currentStep === "depth_context" && <DepthContextScreen {...commonProps} />}
          {currentStep === "your_account" && <YourAccountScreen {...commonProps} />}
          {currentStep === "what_next" && <WhatNextScreen {...commonProps} onClose={onClose} />}

          {/* Path 2 — Map Scatter */}
          {currentStep === "scatter_confirm" && <ScatterConfirmScreen {...commonProps} onSwitchToInsitu={() => { setPath("stop_secure"); goToStep("observe"); }} />}
          {currentStep === "scatter_recording" && <ScatterRecordingScreen {...commonProps} onSwitchToInsitu={() => { setPath("stop_secure"); goToStep("observe"); }} />}
          {currentStep === "scatter_complete" && <ScatterCompleteScreen {...commonProps} onClose={onClose} />}

          {/* Path 3 — Notable Find */}
          {currentStep === "photo_capture" && <PhotoCaptureScreen {...commonProps} />}
          {currentStep === "record_context" && <RecordContextScreen {...commonProps} />}
          {currentStep === "describe_find" && <DescribeFindScreen {...commonProps} />}
          {currentStep === "find_what_next" && <FindWhatNextScreen {...commonProps} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}
