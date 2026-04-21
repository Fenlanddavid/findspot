import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";

export default function PendingFinds(props: { projectId: string }) {
  const navigate = useNavigate();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const pendingFinds = useLiveQuery(
    () => db.finds
      .where("projectId").equals(props.projectId)
      .filter(f => !!f.isPending)
      .reverse()
      .sortBy("createdAt"),
    [props.projectId]
  );

  async function saveAsIs(id: string) {
    setSavingId(id);
    try {
      await db.finds.update(id, { isPending: false });
    } finally {
      setSavingId(null);
    }
  }

  if (pendingFinds === undefined) {
    return <div className="p-10 text-center opacity-50 font-medium">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pb-20 mt-4">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate("/")}
          className="text-xs font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
        >
          ← Back
        </button>
        <div>
          <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100 tracking-tighter uppercase leading-none">
            Find Queue
          </h2>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-0.5">
            {pendingFinds.length === 0
              ? "All clear"
              : `${pendingFinds.length} pending ${pendingFinds.length === 1 ? "find" : "finds"}`}
          </p>
        </div>
      </div>

      {pendingFinds.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-100 dark:border-emerald-800 flex items-center justify-center text-2xl">
            ✓
          </div>
          <div>
            <p className="font-black text-gray-700 dark:text-gray-200">Queue is empty</p>
            <p className="text-sm text-gray-400 mt-1">All finds have been completed.</p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pendingFinds.map(f => (
            <div
              key={f.id}
              className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                    {f.findCode}
                  </div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mt-0.5">
                    {f.objectType && f.objectType !== "Pending Quick Find" ? f.objectType : "Unidentified find"}
                  </div>
                  {f.notes ? (
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1">{f.notes}</div>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] font-mono text-gray-400">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-[9px] font-mono text-gray-400">
                    {new Date(f.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {f.lat && f.lon ? (
                    <div className="text-[9px] text-emerald-500 font-bold mt-0.5">📍 GPS saved</div>
                  ) : (
                    <div className="text-[9px] text-gray-300 dark:text-gray-600 mt-0.5">No GPS</div>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/find?quickId=${f.id}`)}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-sm"
                >
                  Finish Record
                </button>
                <button
                  onClick={() => saveAsIs(f.id)}
                  disabled={savingId === f.id}
                  className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                >
                  {savingId === f.id ? "Saving…" : "Save As-Is"}
                </button>
                {confirmingDeleteId === f.id ? (
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => { await db.finds.delete(f.id); setConfirmingDeleteId(null); }}
                      className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingDeleteId(f.id)}
                    className="px-3 py-2 border border-red-200 dark:border-red-800 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
