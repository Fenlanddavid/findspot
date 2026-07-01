import React from "react";
import { useNavigate } from "react-router-dom";
import { WorkflowState } from "../../../types/significantFind";
import { db } from "../../../db";
import { getFLOForCounty } from "../../../services/flo";
import { getParishAndCounty } from "../../../services/pas";
import { getSetting } from "../../../services/data";
import { buildNotableFindEmail, buildMailtoLink } from "../../../utils/floEmail";
import { useLiveQuery } from "dexie-react-hooks";
import { Find } from "../../../db";
import { v4 as uuid } from "uuid";
import { toOSGridRef } from "../../../services/gps";
import OrganiserInstructionCard from "../OrganiserInstructionCard";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function FindWhatNextScreen({ workflowState, onClose }: Props) {
  const navigate = useNavigate();
  const [county, setCounty] = React.useState("");
  const [collectorName, setCollectorName] = React.useState("");
  const [createdAt, setCreatedAt] = React.useState<string | undefined>(undefined);

  const linkedFind = useLiveQuery<Find | undefined>(
    () => workflowState.linkedFindId
      ? db.finds.get(workflowState.linkedFindId)
      : Promise.resolve(undefined),
    [workflowState.linkedFindId]
  );

  React.useEffect(() => {
    if (workflowState.lat != null && workflowState.lon != null) {
      getParishAndCounty(workflowState.lat, workflowState.lon)
        .then(({ county: c }) => setCounty(c))
        .catch(() => {});
    }
    if (workflowState.significantFindId) {
      db.significantFinds.update(workflowState.significantFindId, {
        updatedAt: new Date().toISOString(),
      });
      db.significantFinds.get(workflowState.significantFindId).then(sf => {
        if (sf?.createdAt) setCreatedAt(sf.createdAt);
      });
    }
    getSetting("detectorist", "").then(setCollectorName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const floEntry = getFLOForCounty(county);

  const floEmailHref = React.useMemo(() => {
    if (!floEntry) return null;
    const { subject, body } = buildNotableFindEmail(workflowState, linkedFind, collectorName, floEntry, createdAt);
    return buildMailtoLink(floEntry.email, subject, body);
  }, [floEntry, workflowState, linkedFind, collectorName, createdAt]);

  async function handleDone() {
    // Create a proper db.finds record if one isn't already linked
    if (!workflowState.linkedFindId && workflowState.significantFindId) {
      const now = new Date().toISOString();
      const newFindId = uuid();
      const osGridRef = workflowState.osGridRef ||
        (workflowState.lat != null && workflowState.lon != null
          ? toOSGridRef(workflowState.lat, workflowState.lon)
          : "");
      await db.finds.add({
        id: newFindId,
        projectId: workflowState.projectId,
        permissionId: workflowState.permissionId ?? "",
        sessionId: workflowState.sessionId ?? null,
        fieldId: null,
        findCode: `NF-${Date.now().toString().slice(-6)}`,
        objectType: workflowState.findDescription || "Notable Find",
        lat: workflowState.lat,
        lon: workflowState.lon,
        gpsAccuracyM: workflowState.gpsAccuracyM,
        osGridRef,
        w3w: workflowState.w3w ?? "",
        period: "Unknown",
        material: "Other",
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        depthCm: workflowState.depthCm ?? undefined,
        decoration: "",
        completeness: "Complete",
        findContext: workflowState.soilObservations || "",
        storageLocation: "",
        notes: workflowState.firstPersonAccount || "",
        isPending: false,
        isNotableFind: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.significantFinds.update(workflowState.significantFindId, {
        linkedFindId: newFindId,
        workflowStep: null,
        updatedAt: now,
      });
    } else if (workflowState.significantFindId) {
      // linked find already set (e.g. resumed from an existing record); still clear
      await db.significantFinds.update(workflowState.significantFindId, {
        workflowStep: null,
        updatedAt: new Date().toISOString(),
      });
    }
    onClose();
    navigate("/finds-box?tab=significant");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 border-2 border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-3xl mx-auto mb-3">✓</div>
        <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">Record complete.</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Take this to your local FLO for identification and recording. They'll advise on anything else you need to do.
        </p>
      </div>

      <OrganiserInstructionCard workflowState={workflowState} />

      <div className="flex flex-col gap-3">
        {/* FLO — matched if county known, with pre-filled email */}
        {floEntry ? (
          <>
            <a
              href={floEmailHref ?? `mailto:${floEntry.email}`}
              className="flex items-center gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 hover:border-amber-500 rounded-2xl p-4 transition-all"
            >
              <span className="text-2xl shrink-0">✉️</span>
              <div className="flex-1">
                <p className="text-sm font-black text-gray-900 dark:text-gray-100">Email {floEntry.name} — your FLO</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Full record pre-filled — tap to open in your email app</p>
              </div>
              <svg className="shrink-0 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </a>
          </>
        ) : (
          <a
            href="https://finds.org.uk/contacts"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-amber-400 rounded-2xl p-4 transition-all"
          >
            <span className="text-2xl shrink-0">🔍</span>
            <div className="flex-1">
              <p className="text-sm font-black text-gray-900 dark:text-gray-100">Find your local FLO</p>
              <p className="text-xs text-gray-500 mt-0.5">finds.org.uk/contacts — search by county</p>
            </div>
            <svg className="shrink-0 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
        )}

        {/* NCMD */}
        <a
          href="tel:08000025808"
          className="flex items-center gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-amber-400 rounded-2xl p-4 transition-all"
        >
          <span className="text-2xl shrink-0">📞</span>
          <div className="flex-1">
            <p className="text-sm font-black text-gray-900 dark:text-gray-100">NCMD: 0800 002 5808</p>
            <p className="text-xs text-gray-500 mt-0.5">Free helpline — advice and support</p>
          </div>
          <svg className="shrink-0 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      </div>

      <button
        onClick={handleDone}
        className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 hover:opacity-90"
      >
        Done — view record
      </button>
    </div>
  );
}
