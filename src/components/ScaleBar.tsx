import React from "react";

export function ScaleBar(props: { pxPerMm: number; className?: string }) {
  // Find a sensible rounded value for the scale bar
  // We want the bar to be between 40 and 120 pixels wide
  const targetWidthMin = 40;
  const targetWidthMax = 120;

  const possibleUnits = [
    { unit: "mm", mm: 1 },
    { unit: "mm", mm: 2 },
    { unit: "mm", mm: 5 },
    { unit: "cm", mm: 10 },
    { unit: "cm", mm: 20 },
    { unit: "cm", mm: 50 },
    { unit: "cm", mm: 100 },
    { unit: "cm", mm: 200 },
    { unit: "cm", mm: 500 },
    { unit: "m", mm: 1000 },
    { unit: "m", mm: 2000 },
    { unit: "m", mm: 5000 },
    { unit: "m", mm: 10000 },
  ];

  let bestChoice = possibleUnits[0];
  for (const choice of possibleUnits) {
    const width = choice.mm * props.pxPerMm;
    if (width >= targetWidthMin) {
      bestChoice = choice;
      if (width <= targetWidthMax) break;
    }
  }

  const widthPx = bestChoice.mm * props.pxPerMm;
  const label = bestChoice.unit === "cm" ? `${bestChoice.mm / 10}cm` : bestChoice.unit === "m" ? `${bestChoice.mm / 1000}m` : `${bestChoice.mm}mm`;

  return (
    <div className={`flex flex-col items-center ${props.className}`} style={{ width: `${widthPx}px` }}>
      <div 
        className="w-full h-1.5 border-x-2 border-b-2 border-white shadow-[0_0_2px_rgba(0,0,0,0.8)] bg-black/20"
      />
      <div className="text-[10px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,1)] leading-none mt-1 whitespace-nowrap">
        {label}
      </div>
    </div>
  );
}
