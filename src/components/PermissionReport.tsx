import React, { useMemo } from "react";
import { Permission, Find, Media, Session } from "../db";
import { ScaledImage } from "./ScaledImage";

export function PermissionReport(props: {
  permission: Permission;
  sessions: Session[];
  finds: Find[];
  media: Media[];
}) {
  const mediaMap = useMemo(() => {
    const m = new Map<string, Media[]>();
    for (const item of props.media) {
      if (!m.has(item.findId)) m.set(item.findId, []);
      m.get(item.findId)!.push(item);
    }
    return m;
  }, [props.media]);

  const findsBySession = useMemo(() => {
    const map = new Map<string, Find[]>();
    const orphaned: Find[] = [];
    
    for (const f of props.finds) {
        if (f.sessionId) {
            if (!map.has(f.sessionId)) map.set(f.sessionId, []);
            map.get(f.sessionId)!.push(f);
        } else {
            orphaned.push(f);
        }
    }
    return { map, orphaned };
  }, [props.finds]);

  return (
    <div className="bg-white text-black p-8 max-w-4xl mx-auto print:p-0 print:max-w-none report-container">
      <header className="border-b-4 border-black pb-4 mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">Land Permission Report</h1>
          <p className="text-xl font-bold opacity-70">{props.permission.name}</p>
        </div>
        <div className="text-right font-mono text-sm">
          <div>Report Generated: {new Date().toLocaleDateString()}</div>
          <div>FindSpot v0.1.0</div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-8 mb-8 bg-gray-50 p-6 rounded-xl border border-gray-200 print:bg-transparent print:border-none print:p-0">
        <div className="grid gap-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500">Land Details</h2>
          <div className="grid grid-cols-[100px_1fr] gap-x-4 text-sm">
            <span className="font-bold">Type:</span> <span className="capitalize">{props.permission.type || "Individual"}</span>
            <span className="font-bold">Detectorist:</span> <span>{props.permission.collector}</span>
            <span className="font-bold">GPS Center:</span> <span>{props.permission.lat?.toFixed(6)}, {props.permission.lon?.toFixed(6)}</span>
            <span className="font-bold">Land Type:</span> <span className="capitalize">{props.permission.landType}</span>
            <span className="font-bold">Permission:</span> <span>{props.permission.permissionGranted ? "Granted" : "Not specified"}</span>
          </div>
        </div>
        <div className="grid gap-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500">Landowner Contact</h2>
          <div className="grid grid-cols-[100px_1fr] gap-x-4 text-sm">
            <span className="font-bold">Name:</span> <span>{props.permission.landownerName || "N/A"}</span>
            <span className="font-bold">Phone:</span> <span>{props.permission.landownerPhone || "N/A"}</span>
            <span className="font-bold">Email:</span> <span>{props.permission.landownerEmail || "N/A"}</span>
            <span className="font-bold">Address:</span> <span>{props.permission.landownerAddress || "N/A"}</span>
          </div>
        </div>
      </section>

      {props.permission.notes && (
        <section className="mb-8">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">Land Notes</h2>
          <p className="text-sm italic border-l-4 border-gray-200 pl-4">{props.permission.notes}</p>
        </section>
      )}

      <div className="grid gap-12">
        {[...props.sessions].sort((a, b) => b.date.localeCompare(a.date)).map(session => {
            const sessionFinds = findsBySession.map.get(session.id) || [];
            if (sessionFinds.length === 0) return null;

            return (
                <section key={session.id} className="print:break-inside-avoid">
                    <div className="flex justify-between items-end border-b-2 border-black pb-1 mb-4">
                        <h2 className="text-2xl font-black uppercase tracking-tighter">Session: {new Date(session.date).toLocaleDateString()}</h2>
                        <div className="text-[10px] font-mono opacity-50">
                            {session.lat?.toFixed(5)}, {session.lon?.toFixed(5)} • {session.cropType || "No crop info"}
                        </div>
                    </div>

                    <div className="grid gap-8">
                        {sessionFinds.map(find => (
                            <FindDetail key={find.id} find={find} media={mediaMap.get(find.id) || []} />
                        ))}
                    </div>
                </section>
            );
        })}

        {findsBySession.orphaned.length > 0 && (
            <section className="print:break-inside-avoid">
                <h2 className="text-2xl font-black uppercase tracking-tighter mb-4 border-b-2 border-black pb-1">Other/Historical Finds ({findsBySession.orphaned.length})</h2>
                <div className="grid gap-8">
                    {findsBySession.orphaned.map(find => (
                        <FindDetail key={find.id} find={find} media={mediaMap.get(find.id) || []} />
                    ))}
                </div>
            </section>
        )}
      </div>

      <footer className="mt-12 pt-4 border-t border-gray-200 text-center text-[10px] text-gray-400 font-mono italic">
        This document was generated using FindSpot. Total Finds: {props.finds.length} across {props.sessions.length} sessions.
      </footer>
    </div>
  );
}

function FindDetail({ find, media }: { find: Find, media: Media[] }) {
    return (
        <div className="border-b border-gray-100 pb-8 last:border-0 print:break-inside-avoid">
            <div className="flex justify-between items-baseline mb-3">
            <h3 className="text-lg font-bold flex gap-2 items-center">
                <span className="bg-black text-white px-2 py-0.5 text-sm font-mono">{find.findCode}</span>
                {find.objectType || "Unidentified Find"}
            </h3>
            <span className="text-xs font-bold uppercase text-gray-400">Period: {find.period}</span>
            </div>

            <div className="grid grid-cols-[1fr_2fr] gap-6">
            <div className="text-sm grid gap-1 h-fit">
                <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Object</span> {find.objectType} {find.coinType || find.coinDenomination ? `(${[find.coinType, find.coinDenomination].filter(Boolean).join(" - ")})` : ""}</p>
                <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Location</span> 
                    <span className="font-mono text-xs">{find.osGridRef || "N/A"}</span>
                    {find.w3w && <span className="block text-[10px] opacity-60">///{find.w3w.replace("///", "")}</span>}
                </p>
                <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Material</span> {find.material}</p>
                <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Weight</span> {find.weightG ? `${find.weightG}g` : "N/A"}</p>
                <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Completeness</span> {find.completeness}</p>
                {find.decoration && <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Description</span> {find.decoration}</p>}
                {find.notes && <p><span className="font-bold uppercase text-[10px] text-gray-500 block">Notes</span> {find.notes}</p>}
            </div>
            
            <div className="grid grid-cols-2 gap-2">
                {media.map(m => (
                <ScaledImage 
                    key={m.id} 
                    media={m} 
                    className="rounded-lg border border-gray-200 bg-gray-50 aspect-square" 
                    imgClassName="object-cover"
                />
                ))}
            </div>
            </div>
        </div>
    );
}
