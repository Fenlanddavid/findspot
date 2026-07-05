import React from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../db";
import type { Find, Media, UndugSignal } from "../db";
import { ScaledImage } from "./ScaledImage";
import { UndugSignalLogSection } from "./UndugSignalLog";
import { UndugSignalMapSheet } from "./UndugSignalMapSheet";
import type { RallyPersona } from "../utils/rallyPersona";
import { RallyPersonaChip } from "./RallyPersonaChip";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfirmOptions = {
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
};

interface ActivityColumnProps {
    isEdit:                         boolean;
    permissionId:                   string | undefined;
    pendingFinds:                   Find[] | undefined;
    standaloneFinds:                Find[] | undefined;
    finds:                          Find[] | undefined;
    sessions:                       any[] | undefined;
    fields:                         any[] | undefined;
    allMedia:                       Media[] | undefined;
    isClubDayMember:                boolean;
    isRally:                        boolean;
    persona:                        RallyPersona;
    name:                           string;
    landownerName:                  string;
    landownerPhone:                 string;
    landownerEmail:                 string;
    validFrom:                      string;
    lat:                            number | null;
    lon:                            number | null;
    saving:                         boolean;
    onOpenFind:                     (id: string) => void;
    onRecordFind:                   () => void;
    onKeepClubDayAsPersonalRecord:  () => void;
    onShowExportClubDay:            () => void;
    confirmAction:                  (opts: ConfirmOptions) => Promise<boolean>;
    onConvertSignalToFind?:         (signal: UndugSignal) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string | null {
    if (ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const hrs  = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
}

// ─── Sessions subcomponent (shared by individual + rally branches) ───────────

function SessionsPanel({ isEdit, permissionId, sessions, nav }: {
    isEdit: boolean;
    permissionId: string | undefined;
    sessions: any[] | undefined;
    nav: ReturnType<typeof useNavigate>;
}) {
    return (
        <div className="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-inner">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Sessions / Visits</h3>
                <div className="text-xs font-mono bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded font-bold">{sessions?.length ?? 0} total</div>
            </div>

            {!isEdit && (
                <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm px-4">
                    Create the record first to start adding sessions!
                </div>
            )}

            {isEdit && (
                <div className="grid gap-3">
                    <button
                        onClick={() => nav(`/session/new?permissionId=${permissionId}`)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2 mb-4"
                    >
                        + Start New Session (Visit)
                    </button>

                    {sessions && sessions.length > 0 ? (
                        <div className={sessions.length > 4 ? 'max-h-[195px] overflow-y-auto' : ''}>
                            <div className="grid gap-3">
                                {sessions.map((s: any) => (
                                    <button
                                        key={s.id}
                                        onClick={() => nav(`/session/${s.id}`)}
                                        className="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-xl shadow-sm hover:border-emerald-500 transition-all group overflow-hidden relative"
                                    >
                                        {s.hasTracking && (
                                            <div className="absolute top-0 right-0 bg-sky-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-bl uppercase tracking-widest">
                                                GPS TRAIL
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex flex-col gap-0.5 min-w-0">
                                                {s.recorderName && (
                                                    <div className="text-3xs font-black text-teal-600 dark:text-teal-400 truncate">
                                                        {s.recorderName}
                                                    </div>
                                                )}
                                                <div className="font-black text-xs text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 transition-colors">
                                                    {new Date(s.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-3xs font-bold truncate ${s.fieldName ? 'text-emerald-600' : 'text-gray-400 italic'}`}>
                                                        {s.fieldName || "No specific field"}
                                                    </span>
                                                </div>
                                            </div>

                                            {s.findCount > 0 && (
                                                <div className="bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-100 dark:border-emerald-800 px-2 py-1 rounded-lg text-center min-w-[40px]">
                                                    <div className="text-3xs font-black text-emerald-700 dark:text-emerald-400 leading-none">{s.findCount}</div>
                                                    <div className="text-[7px] font-bold text-emerald-600 dark:text-emerald-500 uppercase leading-none mt-0.5">Finds</div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="text-3xs opacity-60 flex items-center justify-between border-t border-gray-50 dark:border-gray-700/50 pt-2 mt-2">
                                            <span className="truncate pr-2">{s.cropType || s.landUse || "General detecting"}</span>
                                            {s.durationMs > 0 && <span className="font-mono font-bold opacity-80 whitespace-nowrap">{formatDuration(s.durationMs)}</span>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-10 opacity-50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl italic text-sm">
                            No sessions recorded yet.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PermissionActivityColumn({
    isEdit,
    permissionId,
    pendingFinds,
    standaloneFinds,
    finds,
    sessions,
    fields,
    allMedia,
    isClubDayMember,
    isRally,
    persona,
    name,
    landownerName,
    landownerPhone,
    landownerEmail,
    validFrom,
    lat,
    lon,
    saving,
    onOpenFind,
    onRecordFind,
    onKeepClubDayAsPersonalRecord,
    onShowExportClubDay,
    confirmAction,
    onConvertSignalToFind,
}: ActivityColumnProps) {
    const nav = useNavigate();
    const [mapSignal, setMapSignal] = React.useState<UndugSignal | null>(null);

    return (
        <>
        <div className="lg:col-span-1 grid gap-6 h-fit">
            {/* Pending Finds Section */}
            {isEdit && pendingFinds && pendingFinds.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/10 border-2 border-amber-200 dark:border-amber-800/50 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-black text-amber-800 dark:text-amber-400 m-0 uppercase tracking-tight">Pending Finds</h3>
                        <div className="text-[10px] font-black bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 px-2 py-0.5 rounded-full">{pendingFinds.length}</div>
                    </div>
                    <div className="grid gap-3">
                        {pendingFinds.map(f => (
                            <button
                                key={f.id}
                                onClick={() => nav(`/find?quickId=${f.id}`)}
                                className="w-full text-left bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800/50 p-3 rounded-xl shadow-sm hover:border-amber-500 transition-all flex items-center gap-3 group"
                            >
                                <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex items-center justify-center text-[9px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">Quick</div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-black text-[10px] text-amber-700 dark:text-amber-500 uppercase tracking-widest leading-none mb-1">Quick Recorded</div>
                                    <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                                        {f.notes || "No notes..."}
                                    </div>
                                    <div className="text-[9px] opacity-60 font-mono mt-0.5">
                                        {new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {f.findCode}
                                    </div>
                                </div>
                                <div className="text-amber-400 group-hover:text-amber-600 transition-colors">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                </div>
                            </button>
                        ))}
                        <p className="text-[9px] text-amber-700/60 dark:text-amber-400/60 text-center italic mt-1 font-medium">
                            {isClubDayMember ? "Tap to add details before exporting to the organiser." : "Tap to add details & assign to a session"}
                        </p>
                    </div>
                </div>
            )}

            {/* Quick Finds Section (Recorded but no session) */}
            {isEdit && standaloneFinds && standaloneFinds.length > 0 && (
                <div className="bg-sky-50 dark:bg-sky-900/10 border-2 border-sky-200 dark:border-sky-800/50 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-black text-sky-800 dark:text-sky-400 m-0 uppercase tracking-tight">{isClubDayMember ? "Recorded Finds" : "Quick Finds"}</h3>
                        <div className="text-[10px] font-black bg-sky-200 dark:bg-sky-800 text-sky-900 dark:text-sky-100 px-2 py-0.5 rounded-full">{standaloneFinds.length}</div>
                    </div>
                    <div className="grid gap-3">
                        {standaloneFinds.map(f => {
                            const thumb = allMedia?.find(m => m.findId === f.id);
                            return (
                                <div key={f.id} className="bg-white dark:bg-gray-800 border border-sky-200 dark:border-sky-800/50 rounded-xl shadow-sm flex flex-col group relative">
                                    <button
                                        onClick={() => onOpenFind(f.id)}
                                        className="w-full text-left p-3 flex items-center gap-3 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all border-b border-gray-50 dark:border-gray-700/50 rounded-t-xl"
                                    >
                                        <div className="w-10 h-10 bg-sky-100 dark:bg-sky-900/50 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                            {thumb ? (
                                                <ScaledImage media={thumb} className="w-full h-full" imgClassName="object-cover" />
                                            ) : (
                                                <span className="text-[9px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">Find</span>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-black text-[10px] text-sky-700 dark:text-sky-500 uppercase tracking-widest leading-none mb-1">Recorded Find</div>
                                            <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                                                {f.objectType}
                                            </div>
                                            <div className="text-[9px] opacity-60 font-mono mt-0.5">
                                                {new Date(f.createdAt).toLocaleDateString()} • {f.findCode}
                                            </div>
                                        </div>
                                        <div className="text-sky-400 group-hover:text-sky-600 transition-colors">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                        </div>
                                    </button>

                                    {/* Quick Actions Bar */}
                                    <div className="p-2 bg-gray-50/50 dark:bg-gray-900/30 flex gap-2 rounded-b-xl">
                                        {isClubDayMember ? (
                                            <button
                                                onClick={() => onOpenFind(f.id)}
                                                className="w-full bg-sky-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-sky-700 transition-all uppercase tracking-widest text-center"
                                            >
                                                Review Find
                                            </button>
                                        ) : sessions && sessions.length > 0 ? (
                                            <div className="relative flex-1 group/link">
                                                <button className="w-full bg-sky-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-sky-700 transition-all uppercase tracking-widest text-center flex items-center justify-center gap-1">
                                                    <span>Link to Visit</span>
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                                </button>

                                                {/* Session Selection Menu - Positioned to pop out without being clipped */}
                                                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border-2 border-sky-400 dark:border-sky-600 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.3)] p-1 hidden group-hover/link:block z-50 animate-in fade-in slide-in-from-top-2">
                                                    <div className="text-[8px] font-black text-sky-600 uppercase p-2 border-b border-gray-50 dark:border-gray-700 mb-1 flex justify-between items-center">
                                                        <span>Select a Visit</span>
                                                        <span className="opacity-50">Recent 5</span>
                                                    </div>
                                                    <div className="max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 pr-1">
                                                        {sessions.slice(0, 5).map((s: any) => (
                                                            <button
                                                                key={s.id}
                                                                onClick={async () => {
                                                                    if (await confirmAction({
                                                                        title: "Link Find to Visit?",
                                                                        message: `Link this find to the session on ${new Date(s.date).toLocaleDateString()}?`,
                                                                        confirmLabel: "Link",
                                                                    })) {
                                                                        await db.finds.update(f.id, {
                                                                            sessionId: s.id,
                                                                            fieldId: s.fieldId || f.fieldId,
                                                                            isPending: false
                                                                        });
                                                                    }
                                                                }}
                                                                className="w-full text-left p-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0 group/item"
                                                            >
                                                                <div className="text-[10px] font-black text-gray-800 dark:text-gray-100 group-hover/item:text-emerald-600 transition-colors leading-tight">
                                                                    {new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                                </div>
                                                                <div className="text-[8px] opacity-60 truncate font-bold mt-0.5">
                                                                    {s.fieldName || "General Location"}
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        onClick={() => nav(`/session/new?permissionId=${permissionId}`)}
                                                        className="w-full text-center p-2 mt-1 text-[8px] font-black text-emerald-600 uppercase hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg transition-colors border-t border-gray-100 dark:border-gray-700"
                                                    >
                                                        + Start New Visit
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => nav(`/session/new?permissionId=${permissionId}`)}
                                                className="w-full bg-emerald-600 text-white text-[9px] font-black py-2 rounded-lg shadow-sm hover:bg-emerald-700 transition-all uppercase tracking-widest text-center"
                                            >
                                                + Create Visit
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <p className="text-[9px] text-sky-700/60 dark:text-sky-400/60 text-center italic mt-1 font-medium px-2 leading-tight">
                            {isClubDayMember ? "These finds will be included when you export your club day data." : "Tap find to view, or link to a visit below."}
                        </p>
                    </div>
                </div>
            )}

            {isClubDayMember ? (
            <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-start gap-4 mb-5">
                    <div>
                        <h3 className="text-xl font-bold text-teal-900 dark:text-teal-100 m-0">Day Record</h3>
                        <p className="text-xs text-teal-700/70 dark:text-teal-300/70 mt-1 leading-relaxed">Finds are saved against this event. Sessions are optional and not needed for club day export.</p>
                    </div>
                    <div className="text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded font-bold text-teal-700 dark:text-teal-300 border border-teal-100 dark:border-teal-800">{finds?.length ?? 0} finds</div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                        <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{finds?.length ?? 0}</div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Recorded</div>
                    </div>
                    <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                        <div className="text-lg font-black text-amber-600 dark:text-amber-300 leading-none">{pendingFinds?.length ?? 0}</div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Pending</div>
                    </div>
                    <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                        <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{fields?.length ?? 0}</div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                    </div>
                </div>
                <div className="grid gap-2">
                    <button
                        onClick={() => onRecordFind()}
                        className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs"
                    >
                        Record Find
                    </button>
                    <button
                        onClick={() => onShowExportClubDay()}
                        className="w-full bg-white dark:bg-gray-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 py-3 rounded-xl font-black shadow-sm hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-all uppercase tracking-widest text-xs"
                    >
                        Send Finds to Organiser
                    </button>
                    <button
                        onClick={onKeepClubDayAsPersonalRecord}
                        disabled={saving}
                        className="w-full bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 py-3 rounded-xl font-black shadow-sm hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all uppercase tracking-widest text-xs disabled:opacity-50"
                    >
                        Keep Rally Record
                    </button>
                </div>
                <p className="text-[10px] text-teal-700/60 dark:text-teal-300/60 mt-3 leading-relaxed">
                    Keep Rally Record leaves the organiser event but keeps your finds, photos, fields, and sessions as your own local rally record.
                </p>
            </div>
            ) : isRally ? (
            <>
            {/* Slim event card */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
                <div className="mb-1"><RallyPersonaChip persona={persona} /></div>
                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0 mb-5">{name || "Unnamed Rally"}</h3>
                <div className="grid gap-4">
                    {landownerName && (
                        <div>
                            <div className="text-3xs font-black uppercase tracking-widest opacity-40 mb-0.5 text-gray-500 dark:text-gray-400">Organiser / Club</div>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName}</p>
                            {landownerPhone && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📞 {landownerPhone}</p>}
                            {landownerEmail && <p className="text-sm text-gray-500 dark:text-gray-400">✉️ {landownerEmail}</p>}
                        </div>
                    )}
                    {validFrom && (!sessions || sessions.length === 0) && (
                        <div>
                            <div className="text-3xs font-black uppercase tracking-widest opacity-40 mb-0.5 text-gray-500 dark:text-gray-400">First dig</div>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{new Date(validFrom).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                        </div>
                    )}
                    {lat != null && lon != null && (
                        <div>
                            <div className="text-3xs font-black uppercase tracking-widest opacity-40 mb-1.5 text-gray-500 dark:text-gray-400">Location</div>
                            <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/70 px-3 py-3 mb-2">
                                <p className="font-mono text-xs font-bold text-gray-700 dark:text-gray-300">{lat.toFixed(6)}, {lon.toFixed(6)}</p>
                                <p className="text-3xs text-gray-400 dark:text-gray-500 mt-1">Map opens only when you choose to view it.</p>
                            </div>
                            <button
                                onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                className="text-3xs font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1"
                            >
                                View on Google Maps ↗
                            </button>
                        </div>
                    )}
                </div>
                {isEdit && (
                    <button
                        onClick={() => nav(`/find?permissionId=${permissionId}`)}
                        className="w-full mt-5 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2"
                    >
                        + Log Find
                    </button>
                )}
            </div>
            {/* Sessions panel — shared with individual permissions */}
            <SessionsPanel
                isEdit={isEdit}
                permissionId={permissionId}
                sessions={sessions}
                nav={nav}
            />
            </>
            ) : (
            <SessionsPanel
                isEdit={isEdit}
                permissionId={permissionId}
                sessions={sessions}
                nav={nav}
            />
            )}

            {/* Signal log — open un-dug signals for this permission */}
            <div id="undug-signal-section">
            <UndugSignalLogSection
                permissionId={permissionId}
                onConvertToFind={onConvertSignalToFind}
                onShowOnMap={(signal) => {
                    if (signal.lat == null || signal.lng == null) return;
                    setMapSignal(signal);
                }}
            />
            </div>
        </div>

        {mapSignal && (
            <UndugSignalMapSheet
                signal={mapSignal}
                onClose={() => setMapSignal(null)}
                onConvertToFind={
                    onConvertSignalToFind
                        ? (s) => {
                              setMapSignal(null);
                              onConvertSignalToFind(s);
                          }
                        : undefined
                }
            />
        )}
        </>
    );
}
