import React from "react";

interface TrackingOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  wakeLockSupported: boolean;
}

export function TrackingOverlay({ isVisible, onClose, wakeLockSupported }: TrackingOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black text-white z-[9999] flex flex-col items-center justify-center p-8 text-center select-none overflow-hidden">
      <div className="max-w-xs opacity-40">
        <div className="w-12 h-12 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-800">
          <span className="text-xl grayscale opacity-50">👣</span>
        </div>
        <h2 className="text-lg font-bold mb-2 uppercase tracking-widest text-gray-400">Tracking Active</h2>
        <p className="text-[10px] opacity-40 mb-8 font-medium">
          {wakeLockSupported 
            ? "Screen will stay awake for high-precision GPS tracking." 
            : "Keep your screen on manually for accurate GPS tracking."}
        </p>
      </div>

      <button 
        onClick={onClose}
        type="button"
        className="mt-2 px-4 py-2 bg-gray-900 text-gray-500 border border-gray-800 rounded-lg font-bold text-[10px] uppercase tracking-widest active:bg-gray-800 transition-colors"
      >
        Return to FindSpot
      </button>

      <div className="absolute bottom-6 left-0 right-0 opacity-10 text-[8px] font-black uppercase tracking-[0.3em]">
        Low Distraction Mode
      </div>
    </div>
  );
}
