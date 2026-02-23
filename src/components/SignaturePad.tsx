import React, { useRef, useEffect, useState } from "react";

export function SignaturePad(props: {
  label: string;
  onSave: (dataUrl: string | null) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Support high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
    
    // Fill with white for easier export
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
      setIsEmpty(false);
    }
    // Prevent scrolling when drawing on touch
    if ('touches' in e) e.preventDefault();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (!isEmpty) {
      props.onSave(canvasRef.current?.toDataURL() || null);
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      props.onSave(null);
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${props.className}`}>
      <div className="flex justify-between items-end">
        <label className="text-xs font-black uppercase tracking-widest opacity-40">{props.label}</label>
        <button 
          type="button" 
          onClick={clear}
          className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors"
        >
          Clear ↺
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className="w-full h-32 bg-white border-2 border-gray-100 dark:border-gray-700 rounded-xl cursor-crosshair touch-none"
      />
    </div>
  );
}
