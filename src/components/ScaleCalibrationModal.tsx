import React, { useState, useRef } from "react";
import { Modal } from "./Modal";
import { Media, db } from "../db";
import { ScaleBar } from "./ScaleBar";

export function ScaleCalibrationModal(props: { media: Media; url: string; onClose: () => void }) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [mm, setMm] = useState("10");
  const imgRef = useRef<HTMLImageElement>(null);

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    // Offset is relative to the target element (the image)
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;

    if (points.length >= 2) {
      setPoints([{ x, y }]);
      return;
    }
    const newPoints = [...points, { x, y }];
    setPoints(newPoints);
  }

  const calculatedPxPerMm = React.useMemo(() => {
    if (points.length !== 2 || !imgRef.current) return null;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    
    const naturalWidth = imgRef.current.naturalWidth;
    const displayWidth = imgRef.current.clientWidth;
    const scaleFactor = naturalWidth / displayWidth;
    
    const naturalDistPx = distPx * scaleFactor;
    return naturalDistPx / parseFloat(mm);
  }, [points, mm]);

  async function save() {
    if (calculatedPxPerMm === null) return;
    await db.media.update(props.media.id, { pxPerMm: calculatedPxPerMm, scalePresent: true });
    props.onClose();
  }

  return (
    <Modal onClose={props.onClose} title="Calibrate Digital Scale">
      <div className="grid gap-4">
        <p className="text-sm opacity-75 text-gray-700 dark:text-gray-300">Tap two points on the photo that represent a known distance (e.g. 10mm on a ruler or the diameter of a coin).</p>
        
        <div className="relative cursor-crosshair border-2 border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-black flex items-center justify-center min-h-[300px]">
          <div className="relative inline-block">
            <img 
              ref={imgRef}
              src={props.url} 
              onClick={handleImageClick} 
              className="max-w-full h-auto select-none block" 
              draggable={false}
            />
            <svg className="absolute inset-0 pointer-events-none w-full h-full">
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={8} fill="#ef4444" stroke="white" strokeWidth="2" />
              ))}
              {points.length === 2 && (
                <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="#ef4444" strokeWidth="3" strokeDasharray="4" />
              )}
            </svg>
            
            {points.length === 1 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/50 text-white px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm">
                Tap second point...
              </div>
            )}
          </div>
        </div>

        {points.length === 2 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start gap-4">
                <label className="grid gap-2 flex-1">
                <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Physical distance (mm):</span>
                <div className="flex gap-2">
                    <input 
                    type="number" 
                    className="flex-1 bg-white dark:bg-gray-800 border-2 border-blue-200 dark:border-blue-700 rounded-lg p-2 font-bold"
                    value={mm}
                    onChange={e => setMm(e.target.value)}
                    />
                    <button onClick={save} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-md hover:bg-blue-700 transition-colors">Apply</button>
                </div>
                </label>

                {calculatedPxPerMm && (
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold opacity-60 uppercase mb-2">Preview</span>
                        <div className="bg-gray-800 p-4 rounded-lg flex items-center justify-center">
                            <ScaleBar pxPerMm={calculatedPxPerMm * (imgRef.current ? imgRef.current.clientWidth / imgRef.current.naturalWidth : 1)} />
                        </div>
                    </div>
                )}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-2">
          <button onClick={() => setPoints([])} className="text-sm font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors px-2 py-1">Clear Points</button>
          <button onClick={props.onClose} className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
