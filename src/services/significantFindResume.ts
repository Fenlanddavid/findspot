import { db, SignificantFind } from "../db";
import { WorkflowStep, WorkflowPath, WorkflowState } from "../types/significantFind";

// Authoritative step order per path — used by the filter and the resume context
// builder. If a step is renamed or removed, old workflowStep values that no longer
// appear here are silently treated as "resume at first step" (see buildResumeContext).
export const PATH_STEP_ORDER: Record<NonNullable<WorkflowPath>, WorkflowStep[]> = {
  stop_secure:  ["observe", "photo_scene", "mark_spot", "cover_secure", "depth_context", "your_account", "what_next"],
  map_scatter:  ["scatter_confirm", "scatter_recording", "scatter_complete"],
  notable_find: ["photo_capture", "mark_spot", "record_context", "describe_find", "find_what_next"],
};

const VALID_PATHS = new Set(Object.keys(PATH_STEP_ORDER));

/** Fire-and-forget: persist current wizard step to DB. Never throws. */
export function persistWorkflowProgress(sfId: string, step: WorkflowStep): void {
  db.significantFinds
    .update(sfId, { workflowStep: step, updatedAt: new Date().toISOString() })
    .catch(() => {});
}

/** Clear the resume marker once the wizard exits cleanly. Never throws. */
export function clearWorkflowProgress(sfId: string): void {
  db.significantFinds
    .update(sfId, { workflowStep: null, updatedAt: new Date().toISOString() })
    .catch(() => {});
}

/**
 * Return the most-recently-updated in_progress find that can be resumed,
 * or null if none exists.
 *
 * Membership check (step in PATH_STEP_ORDER[path]) is a forward-compat guard:
 * a record whose workflowStep was renamed in a later build is silently excluded
 * from resume offers rather than opening on the wrong screen.
 */
export async function findResumable(projectId: string): Promise<SignificantFind | null> {
  const candidates = await db.significantFinds
    .where("projectId")
    .equals(projectId)
    .filter(sf => {
      if (sf.status !== "in_progress") return false;
      if (!sf.workflowStep) return false;
      if (!sf.path || !VALID_PATHS.has(sf.path)) return false;
      const order = PATH_STEP_ORDER[sf.path as NonNullable<WorkflowPath>];
      return order.includes(sf.workflowStep as WorkflowStep);
    })
    .toArray();

  if (candidates.length === 0) return null;

  // Most recent by updatedAt (ISO string sort is safe)
  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return candidates[0];
}

/**
 * Map a resumable SignificantFind record to the WorkflowState fields needed
 * to re-enter the wizard at the correct step.
 *
 * permissionName / organiser fields are intentionally omitted — openSignificantFind's
 * enrichment re-derives them from permissionId, and initialContext values win over
 * enrichment for everything mapped here (enrichment uses `initialContext.x ?? fallback`
 * throughout).
 *
 * Fail-safe: if workflowStep is not in PATH_STEP_ORDER[path], falls back to the
 * first step of that path rather than crashing or opening on an unknown screen.
 */
export function buildResumeContext(sf: SignificantFind): Partial<WorkflowState> {
  const path = sf.path as NonNullable<WorkflowPath>;
  const order = PATH_STEP_ORDER[path];

  const resolvedStep: WorkflowStep =
    sf.workflowStep && order.includes(sf.workflowStep as WorkflowStep)
      ? (sf.workflowStep as WorkflowStep)
      : order[0];

  return {
    significantFindId: sf.id,
    path,
    currentStep: resolvedStep,
    permissionId: sf.permissionId,
    sessionId: sf.sessionId,
    lat: sf.lat,
    lon: sf.lon,
    gpsAccuracyM: sf.gpsAccuracyM,
    osGridRef: sf.osGridRef,
    w3w: sf.w3w,
    jurisdiction: sf.jurisdiction,
    initialObservations: sf.initialObservations ?? "",
    firstPersonAccount: sf.firstPersonAccount ?? "",
    depthCm: sf.depthCm ?? null,
    periodEstimate: sf.periodEstimate ?? "",
    preExcavationNotes: sf.preExcavationNotes,
    soilObservations: sf.soilObservations,
    secureCoverNotes: sf.secureCoverNotes ?? "",
    groundSurfacePhotoCaptured: sf.groundSurfacePhotoCaptured,
    findDescription: sf.findDescription ?? "",
    scatterId: sf.scatterId,
    scatterFindIds: sf.scatterFindIds,
    linkedFindId: sf.linkedFindId,
    orientationNotes: sf.orientationNotes ?? "",
  };
}
