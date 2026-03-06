import React from "react";
import { db, Find, Media, Field, Track } from "../db";
import { FindRow } from "./FindRow";
import { useLiveQuery } from "dexie-react-hooks";
import { StaticMapPreview } from "./StaticMapPreview";
import { calculateCoverage } from "../services/coverage";

type SelectedPermission = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  landType: string;
  permissionGranted: boolean;
  findCount: number;
};

export function PermissionPanel(props: {
  selected: SelectedPermission;
  selectedFinds: Find[] | undefined;
  firstPhotoByFindId: Map<string, Media> | undefined;
  onOpenFind: (id: string) => void;
  onEdit: () => void;
  onClose: () => void;
  shownCoverageFieldIds?: Set<string>;
  onToggleFieldCoverage?: (fieldId: string) => void;
  fieldCoverageResults?: Map<string, number>; // fieldId -> percentCovered
  showPermissionCoverage?: boolean;
  onTogglePermissionCoverage?: () => void;
  permissionCoveragePercent?: number;
}) {
  const { selected } = props;
  
  const fields = useLiveQuery(async () => {
    return db.fields.where("permissionId").equals(selected.id).toArray();
  }, [selected.id]);

  const allTracks = useLiveQuery(() => db.tracks.toArray());
  const allSessions = useLiveQuery(() => db.sessions.where("permissionId").equals(selected.id).toArray());

  const cumulativePercent = React.useMemo(() => {
    if (!fields || !allTracks || !allSessions) return null;
    let totalAreaM2 = 0;
    let totalDetectedM2 = 0;

    for (const f of fields) {
        const sessionIds = allSessions.filter(s => s.fieldId === f.id).map(s => s.id);
        const fieldTracks = allTracks.filter(t => t.sessionId && sessionIds.includes(t.sessionId));
        const result = calculateCoverage(f.boundary, fieldTracks);
        if (result) {
            totalAreaM2 += result.totalAreaM2;
            totalDetectedM2 += result.detectedAreaM2;
        }
    }
    return totalAreaM2 > 0 ? (totalDetectedM2 / totalAreaM2) * 100 : null;
  }, [fields, allTracks, allSessions]);

  const permissionRecord = useLiveQuery(() => db.permissions.get(selected.id), [selected.id]);
  const recentFind = useLiveQuery(() => db.finds.where("permissionId").equals(selected.id).reverse().sortBy("createdAt").then(arr => arr[0]), [selected.id]);

  // Derive center for preview
  let previewLat = selected.lat;
  let previewLon = selected.lon;

  if (!previewLat || !previewLon) {
      if (fields && fields.length > 0 && fields[0].boundary?.coordinates?.[0]) {
          const coords = fields[0].boundary.coordinates[0];
          previewLat = coords[0][1];
          previewLon = coords[0][0];
      } else if (recentFind && recentFind.lat && recentFind.lon) {
          previewLat = recentFind.lat;
          previewLon = recentFind.lon;
      }
  }

  return (
    <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl p-4 grid gap-3 shadow-xl max-h-[50vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300 w-[280px] sm:w-96">
      {/* Satellite Preview */}
      <StaticMapPreview 
        lat={previewLat} 
        lon={previewLon} 
        boundary={permissionRecord?.boundary || fields?.[0]?.boundary} 
        className="h-28 -mx-4 -mt-4 mb-1 rounded-none border-b border-gray-100 dark:border-gray-700"
      />

      <div className="flex justify-between gap-3 items-start">
        <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg m-0 text-gray-900 dark:text-white truncate" title={selected.name}>{selected.name}</h3>
            <div className="opacity-75 text-sm font-mono mt-1">
            {selected.lat ? selected.lat.toFixed(5) : "?.?"}, {selected.lon ? selected.lon.toFixed(5) : "?.?"}
            </div>
        </div>
        <div className="flex gap-2 shrink-0">
            {cumulativePercent !== null && (
                <div className={`px-2 py-1 rounded-lg text-[10px] font-black border flex flex-col items-center justify-center min-w-[60px] ${cumulativePercent < 90 ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                    <span className="opacity-60 leading-none mb-0.5 uppercase">Total Gaps</span>
                    <span className="text-sm leading-none">{Math.round(100 - cumulativePercent)}%</span>
                </div>
            )}
            <button 
                onClick={props.onEdit}
                className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-emerald-600 hover:text-white px-2 py-1 rounded transition-colors font-medium"
            >
                Edit
            </button>
            <button onClick={props.onClose} className="text-gray-400 hover:text-gray-900 dark:hover:text-white p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">✕</button>
        </div>
      </div>

      <div className="text-sm opacity-90 flex flex-col gap-2">
        <div className="font-medium text-gray-700 dark:text-gray-300">
            {props.selectedFinds?.length ?? 0} find{(props.selectedFinds?.length ?? 0) === 1 ? "" : "s"} in view
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
            {selected.permissionGranted ? (
                <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full border border-emerald-200 font-bold flex items-center gap-1">✓ Permission Granted</span>
            ) : (
                <span className="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-200 font-medium">⚠️ No Permission Logged</span>
            )}
            {selected.landType && <span className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-600 font-medium capitalize">{selected.landType}</span>}
        </div>
        
        {fields && fields.length > 0 && props.onToggleFieldCoverage ? (
            <div className="grid gap-2 mt-2">
                <h4 className="m-0 text-[10px] font-black uppercase tracking-widest opacity-40">Fields / Coverage</h4>
                {fields.map(f => {
                    const isShown = props.shownCoverageFieldIds?.has(f.id);
                    const coverage = props.fieldCoverageResults?.get(f.id);
                    return (
                        <button 
                            key={f.id}
                            onClick={() => props.onToggleFieldCoverage!(f.id)}
                            className={`w-full py-2 px-3 rounded-xl text-[10px] font-bold transition-all flex items-center justify-between border-2 ${isShown ? 'bg-orange-600 border-orange-600 text-white shadow-md' : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-orange-500'}`}
                        >
                            <span className="truncate flex-1 text-left">🧭 {f.name}</span>
                            {isShown && coverage !== undefined && (
                                <span className="bg-white/20 px-1.5 py-0.5 rounded text-[9px] font-black ml-2 whitespace-nowrap">
                                    {Math.round(100 - coverage)}% GAPS
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        ) : (
            permissionRecord?.boundary && props.onTogglePermissionCoverage && (
                <button 
                    onClick={props.onTogglePermissionCoverage}
                    className={`mt-2 w-full py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 border-2 ${props.showPermissionCoverage ? 'bg-orange-600 border-orange-600 text-white shadow-lg' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800 text-orange-700 dark:text-orange-400 hover:border-orange-500'}`}
                >
                    🧭 {props.showPermissionCoverage ? 'Coverage Active' : 'Show Undetected Gaps'}
                    {props.showPermissionCoverage && props.permissionCoveragePercent !== undefined && (
                        <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">
                            {Math.round(100 - props.permissionCoveragePercent)}% GAPS
                        </span>
                    )}
                </button>
            )
        )}
      </div>

      <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mt-1">
        <h4 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider opacity-60">Finds here</h4>

        {(!props.selectedFinds || props.selectedFinds.length === 0) && (
          <div className="opacity-70 text-sm italic py-2 text-center bg-gray-50 dark:bg-gray-900 rounded-lg">No finds recorded here (in this date range).</div>
        )}

        {props.selectedFinds && props.selectedFinds.length > 0 && (
          <div className="grid gap-2">
            {props.selectedFinds.slice(0, 50).map((s) => (
              <FindRow
                key={s.id}
                find={s}
                thumbMedia={props.firstPhotoByFindId?.get(s.id) ?? null}
                onOpen={() => props.onOpenFind(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
