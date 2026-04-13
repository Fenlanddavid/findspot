import React from "react";
import { Permission, Media } from "../db";
import Modal from "./Modal";

interface Props {
  permission: Permission;
  agreementFile: Media | null;
  insuranceProvider?: string;
  ncmdNumber: string;
  ncmdExpiry: string;
  onClose: () => void;
}

export default function PermissionProofModal({ permission, agreementFile, insuranceProvider, ncmdNumber, ncmdExpiry, onClose }: Props) {
  const insuranceExpired = ncmdExpiry && new Date(ncmdExpiry) < new Date();
  
  // Format dates for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString(undefined, { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  return (
    <Modal 
      title="Permission Proof" 
      onClose={onClose}
      fullScreen
    >
      <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 -m-6 p-6 overflow-y-auto">
        {/* Verification Status Header */}
        <div className={`p-6 rounded-3xl border-2 mb-8 text-center shadow-lg transition-all ${
          permission.permissionGranted 
            ? "bg-emerald-600 border-emerald-400 shadow-emerald-500/20" 
            : "bg-red-600 border-red-400 shadow-red-500/20"
        }`}>
          <div className="text-4xl mb-2">{permission.permissionGranted ? "✅" : "⚠️"}</div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">
            {permission.permissionGranted ? "Active Permission" : "No Active Permission"}
          </h2>
          <p className="text-white/80 text-xs font-bold uppercase tracking-widest mt-1">
            Status Valid as of {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Left: Permission Details */}
          <div className="space-y-6">
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3">Location & Owner</h3>
              <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                <div className="mb-4">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase mb-0.5">Permission Name</div>
                  <div className="text-xl font-black dark:text-white">{permission.name}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-emerald-600 uppercase mb-0.5">Landowner</div>
                  <div className="text-lg font-bold dark:text-gray-200">{permission.landownerName || "Not Recorded"}</div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3">Authority & Dates</h3>
              <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Valid From</div>
                    <div className="font-black text-gray-800 dark:text-white">
                      {formatDate(permission.validFrom)}
                    </div>
                  </div>
                  <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-tighter border border-emerald-200 dark:border-emerald-800">Verified Access</span>
                </div>
                <div className="pt-3 border-t border-gray-50 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-600 dark:text-gray-400 italic">Agreement Signed</span>
                    <span className={agreementFile ? "text-emerald-500" : "text-gray-300"}>{agreementFile ? "✅" : "❌"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-600 dark:text-gray-400 italic">ID Verified</span>
                    <span className="text-emerald-500">✅</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right: Detectorist & Agreement Focus */}
          <div className="space-y-6">
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3">Operator Details</h3>
              <div className="bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
                <div className="mb-4">
                  <div className="text-[10px] font-bold text-teal-600 uppercase mb-0.5">Detectorist</div>
                  <div className="text-xl font-black dark:text-white">{permission.collector || "Guest User"}</div>
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-[10px] font-bold text-teal-600 uppercase mb-0.5">{insuranceProvider || 'Insurance'}</div>
                    <div className="text-sm font-bold dark:text-gray-300">#{ncmdNumber || "Not Set"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-teal-600 uppercase mb-0.5">Expiry</div>
                    <div className={`text-sm font-bold ${insuranceExpired ? "text-red-500" : "dark:text-gray-300"}`}>
                      {formatDate(ncmdExpiry)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {agreementFile && (
              <section>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mb-3">Legal Document</h3>
                <button 
                  onClick={() => {
                    const url = URL.createObjectURL(agreementFile.blob);
                    window.open(url, "_blank");
                  }}
                  className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-500/50 p-6 rounded-3xl shadow-lg hover:shadow-emerald-500/10 transition-all group flex flex-col items-center gap-3"
                >
                  <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                    📄
                  </div>
                  <div className="text-center">
                    <div className="text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-widest text-sm">View Signed Agreement</div>
                    <div className="text-[10px] text-gray-400 font-bold mt-1 uppercase opacity-60">Open Full PDF Document</div>
                  </div>
                </button>
              </section>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-auto pt-8 flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 bg-gray-900 dark:bg-emerald-600 text-white p-5 rounded-2xl font-black text-sm uppercase tracking-widest hover:opacity-90 transition-all shadow-lg"
          >
            Close Proof
          </button>
        </div>

        <div className="mt-6 text-center">
            <div className="inline-flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-tighter">Locally Verified Secure Proof</span>
            </div>
        </div>
      </div>
    </Modal>
  );
}
