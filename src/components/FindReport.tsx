import React from "react";
import { Permission, Find, Media, Session } from "../db";
import { ScaledImage } from "./ScaledImage";

export function FindReport(props: {
  find: Find;
  media: Media[];
  permission?: Permission;
  session?: Session;
  ncmdNumber?: string;
  ncmdExpiry?: string;
}) {
  const { find, media, permission, session, ncmdNumber, ncmdExpiry } = props;

  return (
    <div className="bg-white text-black p-8 max-w-4xl mx-auto print:p-0 print:max-w-none report-container">
      <header className="border-b-4 border-black pb-4 mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">Find Documentation Report</h1>
          <p className="text-xl font-bold opacity-70">{find.findCode}: {find.objectType || "Unidentified Find"}</p>
        </div>
        <div className="text-right font-mono text-sm">
          <div>Report Generated: {new Date().toLocaleDateString()}</div>
          {ncmdNumber && <div>NCMD No: {ncmdNumber}</div>}
          {ncmdExpiry && <div>Insurance Exp: {new Date(ncmdExpiry).toLocaleDateString()}</div>}
          <div>FindSpot v0.1.0</div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <section className="bg-gray-50 p-6 rounded-xl border border-gray-200 print:bg-transparent print:border-none print:p-0">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-4 border-b border-gray-200 pb-1">Object Details</h2>
          <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <span className="font-bold">Object Type:</span> <span>{find.objectType}</span>
            {find.coinType && <><span className="font-bold">Coin Type:</span> <span>{find.coinType}</span></>}
            {find.coinDenomination && <><span className="font-bold">Denomination:</span> <span>{find.coinDenomination}</span></>}
            <span className="font-bold">Period:</span> <span>{find.period}</span>
            <span className="font-bold">Material:</span> <span>{find.material}</span>
            <span className="font-bold">Weight:</span> <span>{find.weightG ? `${find.weightG}g` : "N/A"}</span>
            <span className="font-bold">Completeness:</span> <span>{find.completeness}</span>
            <span className="font-bold">Decoration:</span> <span>{find.decoration || "None recorded"}</span>
          </div>
        </section>

        <section className="bg-gray-50 p-6 rounded-xl border border-gray-200 print:bg-transparent print:border-none print:p-0">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-4 border-b border-gray-200 pb-1">Discovery Location</h2>
          <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <span className="font-bold">Land/Permission:</span> <span>{permission?.name || "N/A"}</span>
            <span className="font-bold">Date Found:</span> <span>{session?.date ? new Date(session.date).toLocaleDateString() : "N/A"}</span>
            <span className="font-bold">OS Grid Ref:</span> <span className="font-mono">{find.osGridRef || "N/A"}</span>
            <span className="font-bold">What3Words:</span> <span>///{find.w3w?.replace("///", "") || "N/A"}</span>
            <span className="font-bold">Coordinates:</span> <span className="font-mono text-xs">{find.lat?.toFixed(6)}, {find.lon?.toFixed(6)}</span>
            <span className="font-bold">GPS Accuracy:</span> <span>{find.gpsAccuracyM ? `±${Math.round(find.gpsAccuracyM)}m` : "N/A"}</span>
            <span className="font-bold">Detectorist:</span> <span>{permission?.collector || "N/A"}</span>
          </div>
        </section>
      </div>

      {find.notes && (
        <section className="mb-8">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">Find Notes</h2>
          <p className="text-sm italic border-l-4 border-gray-200 pl-4 whitespace-pre-wrap">{find.notes}</p>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-4 border-b border-gray-200 pb-1">Photographic Evidence</h2>
        <div className="grid grid-cols-2 gap-4">
          {media.map(m => (
            <div key={m.id} className="break-inside-avoid">
              <ScaledImage 
                media={m} 
                className="rounded-lg border border-gray-200 bg-gray-50 aspect-square overflow-hidden mb-1" 
                imgClassName="object-contain w-full h-full"
              />
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-mono opacity-50">{m.filename}</span>
                {m.photoType && (
                    <span className="text-[8px] font-black uppercase bg-gray-100 px-1 rounded">{m.photoType}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {permission?.landownerName && (
        <section className="mt-8 pt-8 border-t border-gray-100">
          <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">Landowner Confirmation</h2>
          <div className="grid grid-cols-2 gap-8 text-sm italic opacity-60">
            <div>
                <p>This find was recovered with the express permission of:</p>
                <p className="font-bold mt-1">{permission.landownerName}</p>
            </div>
            <div className="flex items-end justify-end">
                <div className="border-b border-gray-300 w-48 h-8"></div>
                <span className="ml-2 text-[10px] non-italic font-black uppercase">Signature</span>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-12 pt-4 border-t border-gray-200 text-center text-[10px] text-gray-400 font-mono italic">
        This document was generated using FindSpot. Find Code: {find.findCode}
      </footer>
    </div>
  );
}
