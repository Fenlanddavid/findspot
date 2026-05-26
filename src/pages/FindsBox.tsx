import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Find, Media, Permission, SignificantFind } from "../db";
import { FindModal } from "../components/FindModal";
import { ScaledImage } from "../components/ScaledImage";
import SignificantFindCard from "../components/significant/SignificantFindCard";
import SignificantFindDetailSheet from "../components/significant/SignificantFindDetailSheet";

type FindsFilter = "all" | "top" | "pending";

const PAGE_SIZE = 60;

const PERIOD_COLORS: Record<string, string> = {
  Prehistoric: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "Bronze Age": "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  "Iron Age": "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  Celtic: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  Roman: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
  "Anglo-Saxon": "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  "Early Medieval": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  Medieval: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  "Post-medieval": "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  Modern: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  Unknown: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

function getFindDate(find: Find) {
  return find.foundAt ?? find.createdAt;
}

function formatFindDate(find: Find) {
  const raw = getFindDate(find);
  if (!raw) return "Undated";
  try {
    return new Date(raw).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "Undated";
  }
}

function getFilter(value: string | null): FindsFilter {
  return value === "top" || value === "pending" ? value : "all";
}

function searchText(find: Find, permission?: Permission) {
  return [
    find.objectType,
    find.findCategory,
    find.findCode,
    find.notes,
    find.period,
    find.material,
    find.coinType,
    find.coinDenomination,
    permission?.name,
  ].filter(Boolean).join(" ").toLowerCase();
}

export default function FindsBox(props: { projectId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [openSfId, setOpenSfId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const mainTab: "finds" | "significant" = searchParams.get("tab") === "significant" ? "significant" : "finds";

  function setMainTab(tab: "finds" | "significant") {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === "significant") next.set("tab", "significant");
      else next.delete("tab");
      return next;
    }, { replace: true });
  }

  const searchQuery = searchParams.get("q") ?? "";
  const activeFilter = getFilter(searchParams.get("filter"));
  const filterPeriod = searchParams.get("period");
  const filterMaterial = searchParams.get("material");
  const filterType = searchParams.get("type");

  const finds = useLiveQuery(
    async () => {
      const rows = await db.finds.where("projectId").equals(props.projectId).toArray();
      return rows.sort((a, b) => getFindDate(b).localeCompare(getFindDate(a)));
    },
    [props.projectId]
  );

  const permissions = useLiveQuery(
    async () => db.permissions.where("projectId").equals(props.projectId).toArray(),
    [props.projectId]
  );

  const significantFinds = useLiveQuery<SignificantFind[]>(
    async () => {
      const rows = await db.significantFinds.where("projectId").equals(props.projectId).toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [props.projectId]
  );

  const sfMediaOwnerIds = useMemo(
    () => Array.from(new Set((significantFinds ?? []).flatMap(sf => [
      sf.id,
      sf.linkedFindId,
      ...(sf.scatterFindIds ?? []),
    ].filter((id): id is string => !!id)))),
    [significantFinds]
  );

  const sfFirstMediaMap = useLiveQuery<Map<string, Media>>(async () => {
    if (!significantFinds || sfMediaOwnerIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(sfMediaOwnerIds).toArray();
    const byOwner = new Map<string, Media>();
    media.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    for (const row of media) {
      if (row.findId && !byOwner.has(row.findId)) byOwner.set(row.findId, row);
    }

    const map = new Map<string, Media>();
    for (const sf of significantFinds) {
      const scatterThumb = (sf.scatterFindIds ?? []).map(id => byOwner.get(id)).find(Boolean);
      const first = byOwner.get(sf.id) ?? (sf.linkedFindId ? byOwner.get(sf.linkedFindId) : undefined) ?? scatterThumb;
      if (first) map.set(sf.id, first);
    }
    return map;
  }, [sfMediaOwnerIds.join("|"), significantFinds]);

  const permissionMap = useMemo(() => {
    const map = new Map<string, Permission>();
    for (const permission of permissions ?? []) map.set(permission.id, permission);
    return map;
  }, [permissions]);

  const stats = useMemo(() => {
    if (!finds) return null;
    return {
      total: finds.length,
      complete: finds.filter(f => !f.isPending).length,
      top: finds.filter(f => !!f.isFavorite && !f.isPending).length,
      pending: finds.filter(f => !!f.isPending).length,
      located: finds.filter(f => f.lat != null && f.lon != null).length,
    };
  }, [finds]);

  const filteredFinds = useMemo(() => {
    if (!finds) return undefined;
    const query = searchQuery.trim().toLowerCase();
    return finds.filter(find => {
      if (activeFilter === "top" && (!find.isFavorite || find.isPending)) return false;
      if (activeFilter === "pending" && !find.isPending) return false;
      if (activeFilter === "all" && find.isPending) return false;
      if (filterPeriod && find.period !== filterPeriod) return false;
      if (filterMaterial && find.material !== filterMaterial) return false;
      if (filterType) {
        const type = filterType.toLowerCase();
        const matchesType = (find.objectType || "").toLowerCase().includes(type) ||
          (find.findCategory || "").toLowerCase().includes(type) ||
          (find.coinType || "").toLowerCase().includes(type);
        if (!matchesType) return false;
      }
      if (query && !searchText(find, permissionMap.get(find.permissionId)).includes(query)) return false;
      return true;
    });
  }, [activeFilter, filterMaterial, filterPeriod, filterType, finds, permissionMap, searchQuery]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeFilter, filterMaterial, filterPeriod, filterType, searchQuery]);

  const visibleFinds = useMemo(
    () => filteredFinds?.slice(0, visibleCount) ?? [],
    [filteredFinds, visibleCount]
  );

  const findIds = useMemo(() => visibleFinds.map(find => find.id), [visibleFinds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const map = new Map<string, Media>();
    media.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    for (const row of media) {
      if (row.findId && !map.has(row.findId)) map.set(row.findId, row);
    }
    return map;
  }, [findIds]);

  function updateSearch(value: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value.trim()) next.set("q", value);
      else next.delete("q");
      return next;
    }, { replace: true });
  }

  function setFilter(filter: FindsFilter) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (filter === "all") next.delete("filter");
      else next.set("filter", filter);
      return next;
    }, { replace: true });
  }

  function openMapView() {
    const next = new URLSearchParams(searchParams);
    next.set("view", "map");
    if (next.get("filter") === "top") next.delete("filter");
    navigate(`/finds?${next.toString()}`);
  }

  const isLoading = finds === undefined || permissions === undefined;
  const hasAnyFinds = (stats?.total ?? 0) > 0;
  const noMatches = !isLoading && hasAnyFinds && (filteredFinds?.length ?? 0) === 0;
  const emptyMain = !isLoading && !hasAnyFinds;
  const hasFilters = !!searchQuery || activeFilter !== "all" || !!filterPeriod || !!filterMaterial || !!filterType;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24">
      <header className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <h1 className="m-0 text-3xl font-black tracking-tight text-gray-950 dark:text-gray-50">Finds</h1>

          <div className="mt-3 flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
            <button
              type="button"
              onClick={() => setMainTab("finds")}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${
                mainTab === "finds"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Finds
            </button>
            <button
              type="button"
              onClick={() => setMainTab("significant")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${
                mainTab === "significant"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Significant
              {(significantFinds?.length ?? 0) > 0 && (
                <span className="rounded-full bg-red-500 text-white text-[9px] font-black w-4 h-4 flex items-center justify-center leading-none">
                  {significantFinds!.length}
                </span>
              )}
            </button>
          </div>

          {mainTab === "finds" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition-colors ${activeFilter === "all" ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950" : "border-gray-200 bg-white text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
              >
                <div className="text-base font-black leading-none">{stats?.complete ?? "--"}</div>
                <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">All</div>
              </button>
              <button
                type="button"
                onClick={() => setFilter("top")}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition-colors ${activeFilter === "top" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-amber-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
              >
                <div className="text-base font-black leading-none">{stats?.top ?? "--"}</div>
                <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">Top</div>
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition-colors ${activeFilter === "pending" ? "border-amber-600 bg-amber-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:border-amber-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
              >
                <div className="text-base font-black leading-none">{stats?.pending ?? "--"}</div>
                <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">Pending</div>
              </button>
              <div className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2 text-left text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <div className="text-base font-black leading-none">{stats?.located ?? "--"}</div>
                <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">Mapped</div>
              </div>
            </div>
          )}
        </div>

        {mainTab === "finds" && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => navigate("/find?manual=true")}
              className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-emerald-500"
            >
              Add Find
            </button>
            <button
              type="button"
              onClick={openMapView}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-emerald-700"
            >
              Map View
            </button>
          </div>
        )}
      </header>

      {mainTab === "significant" && (
        <div className="mt-6 flex flex-col gap-3">
          {!significantFinds && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
                  <div className="h-4 w-1/3 rounded bg-gray-100 dark:bg-gray-700 mb-2" />
                  <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          )}
          {significantFinds && significantFinds.length === 0 && (
            <div className="mt-4 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 px-5 py-16 text-center">
              <div className="text-4xl mb-3">SF</div>
              <h2 className="mb-2 text-xl font-black text-gray-900 dark:text-gray-100">No significant finds yet</h2>
              <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-gray-400">
                When you use the significant finds workflow (Stop &amp; Secure, Map Scatter, or Notable Find), records appear here.
              </p>
            </div>
          )}
          {significantFinds?.map(sf => (
            <SignificantFindCard
              key={sf.id}
              significantFind={sf}
              thumbnail={sfFirstMediaMap?.get(sf.id)}
              onOpen={() => setOpenSfId(sf.id)}
            />
          ))}
        </div>
      )}

      {mainTab === "finds" && (
        <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search finds</span>
              <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => updateSearch(e.target.value)}
                placeholder="Search finds, permissions, periods, notes..."
                className="min-h-11 w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none transition-all focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => setSearchParams({}, { replace: true })}
                className="min-h-11 rounded-xl border border-gray-200 px-4 text-xs font-black uppercase tracking-widest text-gray-500 transition-colors hover:border-red-300 hover:text-red-600 dark:border-gray-700 dark:text-gray-400"
              >
                Clear
              </button>
            )}
          </form>
          {(filterPeriod || filterMaterial || filterType) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {filterPeriod && (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  {filterPeriod}
                </span>
              )}
              {filterMaterial && (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  {filterMaterial}
                </span>
              )}
              {filterType && (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  {filterType}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {mainTab === "finds" && isLoading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="aspect-[4/3] animate-pulse bg-gray-100 dark:bg-gray-900" />
              <div className="grid gap-2 p-4">
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {mainTab === "finds" && emptyMain && (
        <div className="mt-6 rounded-3xl border-2 border-dashed border-gray-200 bg-white px-5 py-16 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800/40">
          <h2 className="mb-2 text-xl font-black text-gray-900 dark:text-gray-100">No finds yet</h2>
          <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-gray-400">Start a record manually, or use quick capture while detecting.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/find?manual=true")}
              className="min-h-11 rounded-xl bg-emerald-600 px-5 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500"
            >
              Add Find
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-5 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              Home
            </button>
          </div>
        </div>
      )}

      {mainTab === "finds" && noMatches && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-2 text-lg font-black text-gray-900 dark:text-gray-100">No matching finds</h2>
          <button
            type="button"
            onClick={() => setSearchParams({}, { replace: true })}
            className="mt-3 min-h-11 rounded-xl border border-gray-200 px-5 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300"
          >
            Clear filters
          </button>
        </div>
      )}

      {mainTab === "finds" && !isLoading && !emptyMain && !noMatches && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleFinds.map(find => {
              const media = firstMediaMap?.get(find.id);
              const permission = permissionMap.get(find.permissionId);
              const periodClass = PERIOD_COLORS[find.period] ?? PERIOD_COLORS.Unknown;
              return (
                <button
                  key={find.id}
                  type="button"
                  onClick={() => setOpenFindId(find.id)}
                  className={`group overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:bg-gray-800 ${find.isPending ? "border-amber-300 dark:border-amber-700" : "border-gray-200 hover:border-emerald-200 dark:border-gray-700 dark:hover:border-emerald-800"}`}
                  aria-label={`Open ${find.objectType || "find"} ${find.findCode}`}
                >
                  <div className="relative aspect-[4/3] bg-gray-100 dark:bg-gray-900">
                    {media ? (
                      <ScaledImage
                        media={media}
                        className="h-full w-full"
                        imgClassName="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-widest text-gray-300 dark:text-gray-600">
                        No photo
                      </div>
                    )}
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                      <span className="rounded-lg bg-black/65 px-2 py-1 font-mono text-[9px] font-bold text-white shadow-sm backdrop-blur">
                        {find.findCode}
                      </span>
                      {find.isPending && (
                        <span className="rounded-lg bg-amber-500 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white shadow-sm">
                          Pending
                        </span>
                      )}
                    </div>
                    {find.isFavorite && (
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-sm text-amber-500 shadow-sm dark:bg-gray-950/80">
                        *
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 p-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-black text-gray-900 transition-colors group-hover:text-emerald-600 dark:text-gray-100 dark:group-hover:text-emerald-400">
                        {find.objectType || (find.isPending ? "Pending find" : "Unidentified")}
                      </h2>
                      <div className="mt-1 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <span className="truncate">{permission?.name || "No permission"}</span>
                        <span className="shrink-0 opacity-50">-</span>
                        <span className="shrink-0">{formatFindDate(find)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest ${periodClass}`}>
                        {find.period}
                      </span>
                      {find.material !== "Other" && (
                        <span className="rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                          {find.material}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredFinds && visibleCount < filteredFinds.length && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                className="min-h-11 rounded-xl border border-gray-200 bg-white px-5 text-xs font-black uppercase tracking-widest text-gray-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {openFindId && (
        <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
      )}

      {openSfId && (
        <SignificantFindDetailSheet sfId={openSfId} onClose={() => setOpenSfId(null)} />
      )}
    </div>
  );
}
