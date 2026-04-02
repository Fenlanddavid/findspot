import React, { useState, useEffect } from "react";
import { db, Field } from "../db";
import { v4 as uuid } from "uuid";
import { Modal } from "./Modal";
import { BoundaryPickerModal } from "./BoundaryPickerModal";

interface FieldModalProps {
  projectId: string;
  permissionId: string;
  permissionBoundary?: any;
  permissionLat?: number | null;
  permissionLon?: number | null;
  field?: Field;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function FieldModal({ projectId, permissionId, permissionBoundary, permissionLat, permissionLon, field, onClose, onSaved }: FieldModalProps) {
  const [name, setName] = useState(field?.name ?? "");
  const [notes, setNotes] = useState(field?.notes ?? "");
  const [boundary, setBoundary] = useState<any | null>(field?.boundary ?? null);
  const [isPickingBoundary, setIsPickingBoundary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError("Please enter a field name.");
      return;
    }
    if (!boundary) {
      setError("Please define a field boundary.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const id = field?.id ?? uuid();
      
      const newField: Field = {
        id,
        projectId,
        permissionId,
        name: name.trim(),
        boundary,
        notes: notes.trim(),
        createdAt: field?.createdAt ?? now,
        updatedAt: now
      };

      if (field) {
        await db.fields.update(id, newField);
      } else {
        await db.fields.add(newField);
      }
      onSaved(id);
    } catch (e: any) {
      setError("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={field ? "Edit Field" : "Add New Field"} onClose={onClose}>
      <div className="grid gap-6">
        <label className="block">
          <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Field Name</div>
          <input 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="e.g., North Field, The Paddock" 
            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
          />
        </label>

        <div className="bg-emerald-50/50 dark:bg-emerald-900/20 p-5 rounded-2xl border-2 border-emerald-100/50 dark:border-emerald-800/30 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Field Boundary</div>
            <button 
                type="button" 
                onClick={() => setIsPickingBoundary(true)} 
                className={`px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all border ${boundary ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-800 text-emerald-600 border-emerald-100 dark:border-emerald-900 hover:bg-emerald-600 hover:text-white'}`}
            >
                {boundary ? "📐 Boundary Set ✓" : "📐 Define Boundary"}
            </button>
        </div>

        <label className="block">
          <div className="mb-2 text-sm font-bold text-gray-700 dark:text-gray-300">Field Notes</div>
          <textarea 
            value={notes} 
            onChange={(e) => setNotes(e.target.value)} 
            rows={3} 
            className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
          />
        </label>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 font-medium">{error}</div>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !boundary}
          className="bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-black text-lg shadow-xl transition-all disabled:opacity-50"
        >
          {saving ? "Saving..." : field ? "Update Field ✓" : "Add Field →"}
        </button>
      </div>

      {isPickingBoundary && (
        <BoundaryPickerModal 
          initialBoundary={boundary}
          permissionBoundary={permissionBoundary}
          initialLat={permissionLat}
          initialLon={permissionLon}
          onClose={() => setIsPickingBoundary(false)}
          onSelect={(b) => {
            setBoundary(b);
            setIsPickingBoundary(false);
          }}
        />
      )}
    </Modal>
  );
}
