import React, { useEffect, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Find, Media } from "../db";
import { Modal } from "./Modal";
import { v4 as uuid } from "uuid";
import { fileToBlob } from "../services/photos";
import { captureGPS, toOSGridRef } from "../services/gps";
import { ScaleCalibrationModal } from "./ScaleCalibrationModal";
import { ScaledImage } from "./ScaledImage";

export function FindModal(props: { findId: string; onClose: () => void }) {
  const find = useLiveQuery(async () => db.finds.get(props.findId), [props.findId]);
  const media = useLiveQuery(async () => db.media.where("findId").equals(props.findId).toArray(), [props.findId]);
  const [draft, setDraft] = useState<Find | null>(null);
  const [busy, setBusy] = useState(false);
  
  const [calibratingMedia, setCalibratingMedia] = useState<{ media: Media; url: string } | null>(null);

  useEffect(() => {
    if (find) setDraft(find);
  }, [find?.id]);

  const imageUrls = useMemo(() => {
    const urls: { id: string; url: string; filename: string; media: Media }[] = [];
    for (const m of media ?? []) {
      const url = URL.createObjectURL(m.blob);
      urls.push({ id: m.id, url, filename: m.filename, media: m });
    }
    return urls;
  }, [media]);

  useEffect(() => {
    return () => {
      for (const x of imageUrls) URL.revokeObjectURL(x.url);
    };
  }, [imageUrls]);

  if (!draft) return <Modal onClose={props.onClose} title="Loading…"><div>Loading data...</div></Modal>;

  async function doGPS() {
    if (!draft) return;
    setBusy(true);
    try {
      const fix = await captureGPS();
      const grid = toOSGridRef(fix.lat, fix.lon);
      setDraft({
        ...draft,
        lat: fix.lat,
        lon: fix.lon,
        gpsAccuracyM: fix.accuracyM,
        osGridRef: grid || draft.osGridRef,
      });
    } catch (e: any) {
      alert(e.message || "GPS failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const now = new Date().toISOString();
    await db.finds.update(draft.id, { ...draft, updatedAt: now });
    setBusy(false);
    props.onClose();
  }

  async function del() {
    if (!draft) return;
    if (!confirm("Delete this find?")) return;
    setBusy(true);
    await db.media.where("findId").equals(draft.id).delete();
    await db.finds.delete(draft.id);
    setBusy(false);
    props.onClose();
  }

  async function addPhotos(files: FileList | null, photoType?: Media["photoType"]) {
    if (!draft || !files || files.length === 0) return;
    setBusy(true);
    const now = new Date().toISOString();

    const items: Media[] = [];
    for (const f of Array.from(files)) {
      const blob = await fileToBlob(f);
      items.push({
        id: uuid(),
        projectId: draft.projectId,
        findId: draft.id,
        type: "photo" as const,
        photoType: photoType || "other",
        filename: f.name,
        mime: f.type || "application/octet-stream",
        blob,
        caption: "",
        scalePresent: false,
        createdAt: now,
      });
    }
    await db.media.bulkAdd(items);
    setBusy(false);
  }

  async function removePhoto(mediaId: string) {
    if (!confirm("Remove this photo?")) return;
    setBusy(true);
    await db.media.delete(mediaId);
    setBusy(false);
  }

  return (
    <>
      <Modal onClose={props.onClose} title={`Find: ${draft.findCode}`}>
        <div className="grid gap-4 max-h-[80vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="grid gap-1">
                <span className="text-sm font-bold opacity-75">Object Type / Identification</span>
                <input className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" value={draft.objectType} onChange={(e) => setDraft({ ...draft, objectType: e.target.value })} />
            </label>

                                {(draft.objectType.toLowerCase().includes("coin") || draft.coinType) && (

                                  <div className="grid grid-cols-1 gap-4 p-3 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-900/20 animate-in slide-in-from-left-2">

                                      <label className="grid gap-1">

                                          <span className="text-sm font-bold opacity-75 text-emerald-600 dark:text-emerald-400">Coin Classification</span>

                                          <select 

                                              className="w-full bg-white dark:bg-gray-800 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"

                                              value={draft.coinType || ""} 

                                              onChange={(e) => setDraft({ ...draft, coinType: e.target.value })}

                                          >

                                              <option value="">(Select)</option>

                                              <option value="Hammered">Hammered</option>

                                              <option value="Milled">Milled</option>

                                              <option value="Token">Token / Jetton</option>

                                              <option value="Other">Other</option>

                                          </select>

                                      </label>

                                      <label className="grid gap-1">

                                          <span className="text-sm font-bold opacity-75 text-emerald-600 dark:text-emerald-400">Denomination</span>

                                          <input 

                                              list="modal-denominations"

                                              className="w-full bg-white dark:bg-gray-800 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 

                                              value={draft.coinDenomination || ""} 

                                              onChange={(e) => setDraft({ ...draft, coinDenomination: e.target.value })} 

                                              placeholder="e.g., Stater, Penny, Shilling"

                                          />

                                          <datalist id="modal-denominations">

                                              <option value="Stater" />

                                              <option value="Quarter Stater" />

                                              <option value="Unit" />

                                              <option value="Minim" />

                                              <option value="Denarius" />

                                              <option value="Antoninianus" />

                                              <option value="Sestertius" />

                                              <option value="Dupondius" />

                                              <option value="As" />

                                              <option value="Follis" />

                                              <option value="Sceat" />

                                              <option value="Penny" />

                                              <option value="Halfpenny" />

                                              <option value="Farthing" />

                                              <option value="Groat" />

                                              <option value="Half Groat" />

                                              <option value="Threepence" />

                                              <option value="Sixpence" />

                                              <option value="Shilling" />

                                              <option value="Florin" />

                                              <option value="Halfcrown" />

                                              <option value="Crown" />

                                              <option value="Sovereign" />

                                              <option value="Guinea" />

                                              <option value="Noble" />

                                              <option value="Ryal" />

                                              <option value="Jetton" />

                                          </datalist>

                                      </label>

                                  </div>

                                )}          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-bold opacity-75">Period</span>
              <select 
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                value={draft.period} 
                onChange={(e) => setDraft({ ...draft, period: e.target.value as any })}
              >
                {["Prehistoric", "Bronze Age", "Iron Age", "Celtic", "Roman", "Anglo-Saxon", "Early Medieval", "Medieval", "Post-medieval", "Modern", "Unknown"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-sm font-bold opacity-75">Material</span>
              <select 
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                value={draft.material} 
                onChange={(e) => setDraft({ ...draft, material: e.target.value as any })}
              >
                {["Gold", "Silver", "Copper alloy", "Lead", "Iron", "Tin", "Pewter", "Pottery", "Flint", "Stone", "Glass", "Bone", "Other"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-bold opacity-75">Weight (g)</span>
              <input type="number" className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" value={draft.weightG || ""} onChange={(e) => setDraft({ ...draft, weightG: e.target.value ? parseFloat(e.target.value) : null })} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-bold opacity-75">Completeness</span>
              <select 
                className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                value={draft.completeness} 
                onChange={(e) => setDraft({ ...draft, completeness: e.target.value as any })}
              >
                {["Complete", "Incomplete", "Fragment"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-bold opacity-75">Decoration / Description</span>
            <input className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" value={draft.decoration} onChange={(e) => setDraft({ ...draft, decoration: e.target.value })} />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-bold opacity-75">Notes</span>
            <textarea 
              className="w-full bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
              value={draft.notes} 
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={3} 
            />
          </label>

          <div className="bg-gray-50/50 dark:bg-gray-900/30 p-4 rounded-xl border border-gray-200 dark:border-gray-700 grid gap-3">
            <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Findspot Location</span>
                <button type="button" onClick={doGPS} disabled={busy} className="bg-emerald-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold shadow-sm transition-all flex items-center gap-1">
                    📍 {draft.lat ? "Update" : "Capture"}
                </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-0.5">
                    <span className="text-[10px] font-bold opacity-50 uppercase">OS Grid Ref</span>
                    <input className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-1.5 text-xs font-mono" value={draft.osGridRef || ""} onChange={(e) => setDraft({ ...draft, osGridRef: e.target.value })} />
                </label>
                <label className="grid gap-0.5">
                    <span className="text-[10px] font-bold opacity-50 uppercase">What3Words</span>
                    <input className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-1.5 text-xs" value={draft.w3w || ""} onChange={(e) => setDraft({ ...draft, w3w: e.target.value })} placeholder="///word.word.word" />
                </label>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex flex-col gap-3 mb-3">
              <div className="grid gap-0.5">
                <h4 className="m-0 font-bold text-sm">Photos</h4>
                {imageUrls.length > 0 && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">
                    Tip: Tap photo to set scale
                  </p>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                  <label className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer hover:bg-amber-100 transition-colors shadow-sm text-center flex items-center justify-center gap-1">
                  🕳️ In-Situ
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "in-situ")} className="hidden" />
                  </label>
                  <label className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer hover:bg-blue-100 transition-colors shadow-sm text-center flex items-center justify-center gap-1">
                  🧼 Cleaned
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "cleaned")} className="hidden" />
                  </label>
              </div>
              
              <label className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer hover:bg-gray-200 transition-colors shadow-sm text-center">
                📁 Upload Files
                <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} className="hidden" />
              </label>
            </div>

            {imageUrls.length === 0 && <div className="text-sm opacity-60 italic text-center py-4 bg-gray-50 dark:bg-gray-900 rounded-xl border-2 border-dashed border-gray-100 dark:border-gray-800">No photos attached.</div>}

            {imageUrls.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {imageUrls.map((x) => (
                  <div key={x.id} className="relative group border-2 border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden aspect-square shadow-sm cursor-pointer" onClick={() => setCalibratingMedia({ media: x.media, url: x.url })}>
                    <ScaledImage 
                      media={x.media} 
                      imgClassName="object-cover" 
                      className="w-full h-full" 
                    />

                    <button 
                      onClick={(e) => { e.stopPropagation(); removePhoto(x.id); }} 
                      disabled={busy}
                      className="absolute top-1 right-1 bg-red-600 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110 active:scale-95 z-10"
                    >✕</button>
                    <div className="bg-white/90 dark:bg-gray-900/90 p-1 text-[9px] truncate absolute bottom-0 inset-x-0 font-mono text-center z-10 flex justify-between items-center px-1">
                       <span className="truncate flex-1">{x.filename}</span>
                       {x.media.photoType && (
                         <span className={`px-1 rounded uppercase text-[7px] font-black ${x.media.photoType === 'in-situ' ? 'bg-amber-100 text-amber-800' : x.media.photoType === 'cleaned' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                           {x.media.photoType}
                         </span>
                       )}
                    </div>
                    
                    <div className={`absolute inset-0 bg-emerald-600/20 transition-opacity flex items-center justify-center z-10 ${x.media.pxPerMm ? 'opacity-0 group-hover:opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}>
                        <span className={`bg-white dark:bg-gray-800 text-[10px] font-bold px-2 py-1 rounded-full shadow-sm ${!x.media.pxPerMm ? 'ring-2 ring-emerald-500 animate-bounce' : ''}`}>
                          {x.media.pxPerMm ? 'Rescale' : 'Set Scale'}
                        </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-4 mt-2 pt-3 border-t border-gray-100 dark:border-gray-700 justify-between items-center">
            <button onClick={del} disabled={busy} className="text-red-600 hover:text-red-800 text-sm font-bold px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              Delete Find
            </button>

            <div className="flex gap-3">
              <button onClick={props.onClose} disabled={busy} className="px-4 py-2 rounded-xl text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors font-bold text-sm">Cancel</button>
              <button onClick={save} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-xl shadow-md font-bold transition-all disabled:opacity-50 text-sm">Save Changes</button>
            </div>
          </div>
        </div>
      </Modal>

      {calibratingMedia && (
        <ScaleCalibrationModal 
          media={calibratingMedia.media} 
          url={calibratingMedia.url} 
          onClose={() => setCalibratingMedia(null)} 
        />
      )}
    </>
  );
}