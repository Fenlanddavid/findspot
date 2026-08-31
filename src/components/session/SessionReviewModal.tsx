import { Modal } from '../Modal';
import { SessionCoverageReview } from '../coverage/SessionCoverageReview';
import { SessionReplay } from './SessionReplay';

export function SessionReviewModal({
  sessionId,
  findsCount,
  pendingCount,
  durationMins,
  totalTime,
  permissionId,
  sharedPermissionId,
  isClubDayMember,
  onClose,
  onFieldReport,
  onLandownerReport,
  onShareLandownerUpdate,
  isSharingLandowner,
  landownerShareError,
  onExportClubDay,
  openSignalCount,
  walkedDistanceMetres,
}: {
  sessionId: string,
  findsCount: number,
  pendingCount: number,
  durationMins: number | null,
  totalTime: string | null,
  permissionId: string | null,
  sharedPermissionId: string | undefined,
  isClubDayMember: boolean,
  onClose: () => void,
  onFieldReport: () => void,
  onLandownerReport: (forField: boolean) => void,
  onShareLandownerUpdate: () => void,
  isSharingLandowner: boolean,
  landownerShareError: string | null,
  onExportClubDay: () => void,
  openSignalCount: number,
  walkedDistanceMetres: number | null,
}) {
  // Fourth stat stays reconstructable and avoids presenting coverage precision.
  let fourthStat: { label: string; value: string } | null = null;
  if (walkedDistanceMetres !== null) {
    fourthStat = { label: "Trail", value: walkedDistanceMetres < 1000 ? `${Math.round(walkedDistanceMetres)}m` : `${(walkedDistanceMetres / 1000).toFixed(1)}km` };
  } else if (durationMins && durationMins > 0 && findsCount > 0) {
    const rate = (findsCount / durationMins) * 60;
    fourthStat = { label: "Find Rate", value: `${rate.toFixed(1)}/hr` };
  } else if (findsCount >= 5) {
    fourthStat = { label: "Result", value: "Cracking!" };
  } else if (findsCount > 0) {
    fourthStat = { label: "Result", value: "Good hunt" };
  }

  return (
      <Modal title="Session Review" onClose={onClose}>
          <div className="flex flex-col gap-5 py-2">
              <SessionCoverageReview sessionId={sessionId} initiallyOpen />
              <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">
                  Session replay
                </summary>
                <div className="mt-4">
                  <SessionReplay sessionId={sessionId} />
                </div>
              </details>
              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                      <span className="text-2xs font-black uppercase tracking-widest opacity-60">Finds</span>
                      <span className="text-sm font-black text-emerald-600">{findsCount}</span>
                  </div>
                  {totalTime && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-2xs font-black uppercase tracking-widest opacity-60">Duration</span>
                        <span className="text-sm font-black text-emerald-600">{totalTime}</span>
                    </div>
                  )}
                  {fourthStat && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800 text-center flex flex-col gap-1">
                        <span className="text-2xs font-black uppercase tracking-widest opacity-60">{fourthStat.label}</span>
                        <span className="text-sm font-black text-emerald-600">{fourthStat.value}</span>
                    </div>
                  )}
              </div>

              {openSignalCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-sky-500 shrink-0">
                    <circle cx="8" cy="12" r="1.5" fill="currentColor" />
                    <path d="M4.5 8.5 A5 5 0 0 1 11.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M1.5 5.5 A9 9 0 0 1 14.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {openSignalCount} {openSignalCount === 1 ? 'signal is' : 'signals are'} still open from this session
                  </span>
                </div>
              )}

              {permissionId && isClubDayMember && sharedPermissionId && (
                <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 flex flex-col gap-3">
                    <div>
                        <p className="text-2xs font-black uppercase tracking-widest opacity-60 mb-1">Club / Rally</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            {pendingCount > 0
                                ? `You have ${pendingCount} pending ${pendingCount === 1 ? 'find' : 'finds'}. Finish those before sending your data to the organiser.`
                                : "Send your sessions and finds to the organiser."}
                        </p>
                    </div>
                    <button
                        onClick={onExportClubDay}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-white font-black py-2 rounded-xl transition-all uppercase tracking-widest text-2xs"
                    >
                        Send to Organiser
                    </button>
                </div>
              )}
              {permissionId && !isClubDayMember && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-2xs font-black uppercase tracking-widest opacity-60">Landowner Report</p>
                    <button
                        onClick={onShareLandownerUpdate}
                        disabled={isSharingLandowner}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2.5 rounded-xl transition-all uppercase tracking-widest text-2xs flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isSharingLandowner ? 'Preparing…' : 'Share with Landowner'}
                    </button>
                    {landownerShareError && (
                        <p className="text-xs font-semibold text-red-600 dark:text-red-400 leading-snug">
                            {landownerShareError}
                        </p>
                    )}
                    <button
                        onClick={() => onLandownerReport(false)}
                        className="w-full border border-emerald-600 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-black py-2.5 rounded-xl transition-all uppercase tracking-widest text-2xs"
                    >
                        Full Report (PDF)
                    </button>
                </div>
              )}

              {!isClubDayMember && (
                <button
                    onClick={onFieldReport}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest text-2xs flex items-center justify-center gap-2"
                >
                    Generate Field Report
                </button>
              )}
              <button
                  onClick={onClose}
                  className="min-h-14 w-full rounded-xl border border-teal-300/70 bg-teal-500 px-4 py-3 text-sm font-black uppercase tracking-widest text-gray-950 shadow-lg shadow-teal-900/25 transition-all hover:bg-teal-400 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/40"
              >
                  Close Review
              </button>
          </div>
      </Modal>
  );
}
