export type WorkflowPath = "stop_secure" | "map_scatter" | "notable_find" | null;

export type Path1Step =
  | "observe"        // Stop and observe — before touching anything
  | "photo_scene"    // Photograph the scene
  | "mark_spot"      // Mark the spot precisely
  | "cover_secure"   // Cover and secure
  | "depth_context"  // Record what you know
  | "your_account"   // Capture your account
  | "what_next";     // What to do next

export type Path2Step =
  | "scatter_confirm"
  | "scatter_recording"
  | "scatter_complete";

export type Path3Step =
  | "photo_capture"   // Photograph in sequence
  | "record_context"  // Record the context
  | "describe_find"   // Describe it
  | "find_what_next"; // What next

export type WorkflowStep =
  | "branch"
  | Path1Step
  | Path2Step
  | Path3Step;

export type Jurisdiction = "england_wales" | "scotland" | "northern_ireland" | "unknown";

// Kept for backwards compatibility with checkTreasureAct utility
export type TreasureActResult = "may_be_reportable" | "probably_not" | "unknown";

export type WorkflowState = {
  currentStep: WorkflowStep;
  path: WorkflowPath;
  triggeredBy: "auto" | "manual";

  projectId: string;
  permissionId: string | null;
  sessionId: string | null;

  jurisdiction: Jurisdiction;

  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  osGridRef: string;
  w3w: string;

  // Path 1
  significantFindId: string | null;
  findDescription: string;
  initialObservations: string;   // What was observed before touching
  firstPersonAccount: string;    // "Describe what happened"
  depthCm: number | null;
  periodEstimate: string;        // "What period do you think this might be and why"
  preExcavationNotes: string;
  soilObservations: string;
  secureCoverNotes: string;      // How the spot was covered/marked after stopping
  groundSurfacePhotoCaptured: boolean;

  // Path 2
  scatterId: string | null;
  scatterFindIds: string[];

  // Path 3
  linkedFindId: string | null;
  orientationNotes: string;      // "Which way was it facing in the ground?"
};

export function initialWorkflowState(projectId: string): WorkflowState {
  return {
    currentStep: "branch",
    path: null,
    triggeredBy: "manual",
    projectId,
    permissionId: null,
    sessionId: null,
    jurisdiction: "unknown",
    lat: null,
    lon: null,
    gpsAccuracyM: null,
    osGridRef: "",
    w3w: "",
    significantFindId: null,
    findDescription: "",
    initialObservations: "",
    firstPersonAccount: "",
    depthCm: null,
    periodEstimate: "",
    preExcavationNotes: "",
    soilObservations: "",
    secureCoverNotes: "",
    groundSurfacePhotoCaptured: false,
    scatterId: null,
    scatterFindIds: [],
    linkedFindId: null,
    orientationNotes: "",
  };
}
