import React from "react";
import { useNavigate } from "react-router-dom";
import { WorkflowState } from "../../../types/significantFind";
import { db } from "../../../db";
import { getFLOForCounty } from "../../../services/flo";
import { getParishAndCounty } from "../../../services/pas";
import { getSetting } from "../../../services/data";
import { buildSecureFindEmail, buildMailtoLink } from "../../../utils/floEmail";
import OrganiserInstructionCard from "../OrganiserInstructionCard";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function WhatNextScreen({ workflowState, onClose }: Props) {
  const navigate = useNavigate();
  const [county, setCounty] = React.useState("");
  const [collectorName, setCollectorName] = React.useState("");
  const [createdAt, setCreatedAt] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (workflowState.significantFindId) {
      db.significantFinds.update(workflowState.significantFindId, {
        status: "awaiting_excavation",
        updatedAt: new Date().toISOString(),
      });
      db.significantFinds.get(workflowState.significantFindId).then(sf => {
        if (sf?.createdAt) setCreatedAt(sf.createdAt);
      });
    }
    if (workflowState.lat != null && workflowState.lon != null) {
      getParishAndCounty(workflowState.lat, workflowState.lon)
        .then(({ county: c }) => setCounty(c))
        .catch(() => {});
    }
    getSetting("detectorist", "").then(setCollectorName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const floEntry = getFLOForCounty(county);

  const floEmailHref = React.useMemo(() => {
    if (!floEntry) return null;
    const { subject, body } = buildSecureFindEmail(workflowState, collectorName, floEntry, createdAt);
    return buildMailtoLink(floEntry.email, subject, body);
  }, [floEntry, workflowState, collectorName, createdAt]);

  function handleDone() {
    onClose();
    navigate("/finds-box?tab=significant");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 border-2 border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-3xl mx-auto mb-3">✓</div>
        <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">You've made an excellent record.</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
          Now tell the landowner, then get expert advice before anyone digs further.
        </p>
      </div>

      <OrganiserInstructionCard workflowState={workflowState} />

      <div className="flex flex-col gap-3">
        <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Two conversations to have</p>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-black flex items-center justify-center mt-0.5">1</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tell the landowner</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">They have a right to know, and their cooperation matters for what comes next. Their details are in your permission record.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-black flex items-center justify-center mt-0.5">2</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Get expert advice</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Your FLO or the NCMD will advise on next steps. No more digging until you've spoken to someone.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Email FLO with full record */}
        {floEmailHref ? (
          <a
            href={floEmailHref}
            className="flex items-center gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 hover:border-amber-500 rounded-2xl p-4 transition-all"
          >
            <span className="text-2xl shrink-0">✉️</span>
            <div className="flex-1">
              <p className="text-sm font-black text-gray-900 dark:text-gray-100">Email {floEntry!.name} — your FLO</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">Full record pre-filled — tap to open in your email app</p>
            </div>
            <svg className="shrink-0 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </a>
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
            <p className="text-xs text-gray-500 mt-0.5">Free helpline — can arrange professional excavation, often within days</p>
          </div>
          <svg className="shrink-0 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3">
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          Don't post the location or photos on social media or detecting forums. Word spreading before experts arrive can attract nighthawks and compromise the site.
        </p>
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
