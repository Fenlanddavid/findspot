import React, { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useNavigate } from "react-router-dom";
import { enrichPermissions } from "../services/permissions";
import { PermissionCard } from "../components/PermissionCard";

export default function AllPermissions(props: { projectId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"permissions" | "rallies">("permissions");
  const navigate = useNavigate();

  const permissions = useLiveQuery(
    async () => {
      let collection = db.permissions.where("projectId").equals(props.projectId);
      let rows = [];
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        rows = await collection
          .filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.notes?.toLowerCase().includes(q) ?? false) ||
            (p.landownerName?.toLowerCase().includes(q) ?? false)
          )
          .reverse()
          .sortBy("createdAt");
      } else {
        rows = await collection.reverse().sortBy("createdAt");
      }

      return enrichPermissions(props.projectId, rows);
    },
    [props.projectId, searchQuery]
  );

  const filteredByMode = permissions
    ?.filter(p => viewMode === "rallies" ? p.type === "rally" : p.type !== "rally" && !p.isDefault)
    .sort((a, b) => {
      if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
      if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? 1 : -1;
      return 0;
    });

  return (
    <div className="max-w-5xl mx-auto pb-20 px-4">
      <div className="flex flex-col gap-4 mb-6 mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
              {viewMode === "rallies" ? "Rallies & Club Digs" : "All Permissions"}
            </h2>
            <p className="text-gray-500 text-sm">
              {viewMode === "rallies" ? "Events you've recorded or plan to attend." : "Browse and search your saved land permissions."}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => navigate(viewMode === "rallies" ? "/permission?type=rally" : "/permission")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold shadow-md transition-all whitespace-nowrap text-sm flex items-center gap-2"
            >
              {viewMode === "rallies" ? "New Rally" : "New Permission"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1 self-start">
            <button
              onClick={() => setViewMode("permissions")}
              className={`px-4 py-1.5 rounded-lg text-2xs font-black uppercase tracking-widest transition-all ${viewMode === "permissions" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              Permissions
            </button>
            <button
              onClick={() => setViewMode("rallies")}
              className={`px-4 py-1.5 rounded-lg text-2xs font-black uppercase tracking-widest transition-all ${viewMode === "rallies" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
            >
              Rallies
            </button>
          </div>
          <div className="relative w-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
            <input
              type="text"
              placeholder={viewMode === "rallies" ? "Search rallies..." : "Search by name, landowner, or notes..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2 pl-10 pr-4 shadow-sm focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 outline-none transition-all text-sm"
            />
          </div>
        </div>
      </div>

      {(!filteredByMode || filteredByMode.length === 0) ? (
        <div className="text-center py-16 px-6 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
            {searchQuery
              ? `No ${viewMode === "rallies" ? "rallies" : "permissions"} match your search.`
              : viewMode === "rallies"
                ? "No rallies recorded yet. Find one in Discover and add it."
                : "No permissions recorded yet."}
          </p>
          {!searchQuery && (
            <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
              {viewMode === "permissions" ? (
                <>
                  <button onClick={() => navigate("/fieldguide")} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-colors">
                    Open FieldGuide
                  </button>
                  <button onClick={() => navigate("/permission")} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest hover:border-emerald-400 transition-colors">
                    New Permission
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => navigate("/discover")} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest transition-colors">
                    Open Discover
                  </button>
                  <button onClick={() => navigate("/permission?type=rally")} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest hover:border-emerald-400 transition-colors">
                    New Rally
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredByMode.map((permission) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              onOpen={() => navigate(`/permission/${permission.id}`)}
              onAddFind={permission.type !== "rally" ? () => navigate(`/find?permissionId=${permission.id}`) : undefined}
              onOpenFieldGuide={permission.lat != null && permission.lon != null
                ? () => navigate(`/fieldguide?lat=${permission.lat}&lng=${permission.lon}`)
                : undefined}
              onTogglePin={() => db.permissions.update(permission.id, { isPinned: !permission.isPinned })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
