import React, { useState } from "react";
import { Modal } from "./Modal";

export function PermissionQuickAddModal(props: { lat: number; lon: number; onCancel: () => void; onCreate: (name: string) => Promise<void>; }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal onClose={props.onCancel} title="Add permission here">
      <div className="opacity-80 text-sm mb-4 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 inline-block">
        {props.lat.toFixed(6)}, {props.lon.toFixed(6)}
      </div>

      <label className="block mb-6">
        <div className="mb-2 font-medium text-sm">Permission Name</div>
        <input 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="e.g., Smith's Farm, West Field" 
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 outline-none"
            autoFocus
        />
      </label>

      <div className="flex gap-3 justify-end">
        <button onClick={props.onCancel} disabled={busy} className="px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors">Cancel</button>
        <button
          onClick={async () => {
            setBusy(true);
            await props.onCreate(name);
            setBusy(false);
          }}
          disabled={busy || !name.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm disabled:opacity-50 transition-colors"
        >
          {busy ? "Creating…" : "Create Permission"}
        </button>
      </div>
    </Modal>
  );
}
