import React from "react";
import { Find, Media } from "../db";
import { FindRow } from "./FindRow";

type SelectedPermission = {
  id: string;
  name: string;
  lat: number;
  lon: number;
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
}) {
  const { selected } = props;
  
  return (
    <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl p-4 grid gap-3 shadow-xl max-h-[50vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-between gap-3 items-start">
        <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg m-0 text-gray-900 dark:text-white truncate" title={selected.name}>{selected.name}</h3>
            <div className="opacity-75 text-sm font-mono mt-1">
            {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
            </div>
        </div>
        <div className="flex gap-2 shrink-0">
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
