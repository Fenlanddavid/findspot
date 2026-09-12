import { FindsMap } from '../components/FindsMap';
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import type { Find, Media, Permission, SignificantFind, UndugSignal } from "../db";
import { pagePersistence } from "../services/pagePersistence";
import { FindModal } from "../components/FindModal";
import { ScaledImage } from "../components/ScaledImage";
import SignificantFindCard from "../components/significant/SignificantFindCard";
import SignificantFindDetailSheet from "../components/significant/SignificantFindDetailSheet";
import { UndugSignalDetailSheet } from "../components/UndugSignalLog";
import { UndugSignalMapSheet } from "../components/UndugSignalMapSheet";
import { formatDate } from "../utils/formatDate";

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
    return formatDate(raw);
  } catch {
    return "Undated";
  }
}

function formatSignalDate(epochMs: number) {
  try {
    return formatDate(epochMs);
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

function signalSummary(signal: UndugSignal) {
  const parts: string[] = [];
  if (signal.vdi) parts.push(`VDI ${signal.vdi}`);
  if (signal.direction) parts.push(signal.direction === "one-way" ? "One-way" : "Two-way");
  if (signal.stability) parts.push(signal.stability.charAt(0).toUpperCase() + signal.stability.slice(1));
  if (signal.conditions) parts.push(signal.conditions.charAt(0).toUpperCase() + signal.conditions.slice(1));
  return parts.join(" · ") || "Signal logged";
}

export default function FindsBox(props: { projectId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [openSfId, setOpenSfId] = useState<string | null>(null);
  const [openSignalId, setOpenSignalId] = useState<string | null>(null);
  const [mapSignal, setMapSignal] = useState<UndugSignal | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const tabParam = searchParams.get("tab");
  const mainTab: "finds" | "significant" | "signals" =
    tabParam === "significant" || tabParam === "signals" ? tabParam : "finds";

  function setMainTab(tab: "finds" | "significant" | "signals") {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === "significant") next.set("tab", "significant");
      else if (tab === "signals") next.set("tab", "signals");
      else next.delete("tab");
      return next;
    }, { replace: true });
  }

  const searchQuery = searchParams.get("q") ?? "";
  const activeFilter = getFilter(searchParams.get("filter"));
  const filterPeriod = searchParams.get("period");
  const filterMaterial = searchParams.get("material");
  const filterType = searchParams.get("type");
  const filterSession = searchParams.get('session');
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPermission = searchParams.get('permission');
  const sort = searchParams.get('sort') ?? 'newest';
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const invalidDates = !validDate(dateFrom) || !validDate(dateTo) || !!(dateFrom && dateTo && dateFrom > dateTo);
  function setParam(key: string, value: string) {
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  }
  const visit = useLiveQuery(async () => filterSession ? pagePersistence.sessions.get(filterSession) : undefined, [filterSession]);
  const mapView = searchParams.get('view') === 'map';
  const selectedId = searchParams.get('selected');
  function openRecord(id: string) {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('selected', id); return next; }, { replace: true });
    setOpenFindId(id);
  }
  function setView(view: 'gallery' | 'map') {
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('view', view); return next; }, { replace: true });
  }
  const openSfParam = searchParams.get("sf");
  const openSignalParam = searchParams.get('signal');

  useEffect(() => {
    if (openSignalParam) setOpenSignalId(openSignalParam);
  }, [openSignalParam]);

  useEffect(() => {
    if (!openSfParam) return;
    let cancelled = false;

    pagePersistence.significantFinds.get(openSfParam).then((sf) => {
      if (cancelled) return;
      if (sf?.projectId === props.projectId) setOpenSfId(openSfParam);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set("tab", "significant");
        next.delete("sf");
        return next;
      }, { replace: true });
    });

    return () => { cancelled = true; };
  }, [openSfParam, props.projectId, setSearchParams]);

  function closeSignificantFind() {
    setOpenSfId(null);
  }

  const finds = useLiveQuery(
    async () => {
      const rows = await pagePersistence.finds.where("projectId").equals(props.projectId).toArray();
      return rows
        .filter(f => !f.scatterId && !f.isNotableFind)
        .sort((a, b) => getFindDate(b).localeCompare(getFindDate(a)));
    },
    [props.projectId]
  );

  const permissions = useLiveQuery(
    async () => pagePersistence.permissions.where("projectId").equals(props.projectId).toArray(),
    [props.projectId]
  );

  const significantFinds = useLiveQuery<SignificantFind[]>(
    async () => {
      const rows = await pagePersistence.significantFinds.where("projectId").equals(props.projectId).toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [props.projectId]
  );

  const undugSignals = useLiveQuery<UndugSignal[]>(
    async () => {
      const [rows, projectPermissions, projectSessions] = await Promise.all([
        pagePersistence.undugSignals.where("status").equals("open").toArray(),
        pagePersistence.permissions.where("projectId").equals(props.projectId).toArray(),
        pagePersistence.sessions.where("projectId").equals(props.projectId).toArray(),
      ]);
      const permissionIds = new Set(projectPermissions.map(p => p.id));
      const sessionIds = new Set(projectSessions.map(s => s.id));
      return rows
        .filter(signal => {
          if (signal.permissionId) return permissionIds.has(signal.permissionId);
          if (signal.sessionId) return sessionIds.has(signal.sessionId);
          return true;
        })
        .sort((a, b) => b.createdAt - a.createdAt);
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
    const media = await pagePersistence.media.where("findId").anyOf(sfMediaOwnerIds).toArray();
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
      top: finds.filter(f => !!f.isFavorite).length,
      pending: finds.filter(f => !!f.isPending).length,
      located: finds.filter(f => f.lat != null && f.lon != null).length,
    };
  }, [finds]);

  const filteredFinds = useMemo(() => {
    if (!finds) return undefined;
    const query = searchQuery.trim().toLowerCase();
    return finds.filter(find => {
      if (activeFilter === "top" && !find.isFavorite) return false;
      if (activeFilter === "pending" && !find.isPending) return false;
      if (filterSession && find.sessionId !== filterSession) return false;
      if (filterPermission && find.permissionId !== filterPermission) return false;
      if (invalidDates) return false;
      const date = getFindDate(find).slice(0, 10);
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
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
    }).sort((a, b) => {
      const aDate = sort === 'edited' ? a.updatedAt || getFindDate(a) : getFindDate(a);
      const bDate = sort === 'edited' ? b.updatedAt || getFindDate(b) : getFindDate(b);
      return (sort === 'oldest' ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate)) || a.id.localeCompare(b.id);
    });
  }, [activeFilter, filterMaterial, filterPeriod, filterType, filterSession, filterPermission, invalidDates, sort, dateFrom, dateTo, finds, permissionMap, searchQuery]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeFilter, filterMaterial, filterPeriod, filterType, filterPermission, filterSession, dateFrom, dateTo, sort, searchQuery]);

  useEffect(() => {
    if (filteredFinds && selectedId && !filteredFinds.some(find => find.id === selectedId)) {
      setOpenFindId(null);
      setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('selected'); return next; }, { replace: true });
    }
  }, [filteredFinds, selectedId, setSearchParams]);

  const visibleFinds = useMemo(
    () => filteredFinds?.slice(0, visibleCount) ?? [],
    [filteredFinds, visibleCount]
  );

  const findIds = useMemo(() => visibleFinds.map(find => find.id), [visibleFinds]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await pagePersistence.media.where("findId").anyOf(findIds).toArray();
    const map = new Map<string, Media>();
    media.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    for (const row of media) {
      if (row.findId && !map.has(row.findId)) map.set(row.findId, row);
    }
    return map;
  }, [findIds]);

  function clearFilters() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const key of ['filter', 'q', 'from', 'to', 'type', 'period', 'material', 'session', 'permission']) next.delete(key);
      return next;
    }, { replace: true });
  }

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

  function convertSignalToFind(signal: UndugSignal) {
    const params = new URLSearchParams();
    params.set("sourceSignalId", signal.id);
    if (signal.permissionId) params.set("permissionId", signal.permissionId);
    if (signal.sessionId) params.set("sessionId", signal.sessionId);
    if (signal.lat != null) params.set("lat", String(signal.lat));
    if (signal.lng != null) params.set("lon", String(signal.lng));
    navigate(`/find?${params.toString()}`);
  }

  function showSignalOnMap(signal: UndugSignal) {
    if (signal.lat == null || signal.lng == null) return;
    setMapSignal(signal);
  }

  const isLoading = finds === undefined || permissions === undefined;
  const hasAnyFinds = (stats?.total ?? 0) > 0;
  const noMatches = !isLoading && hasAnyFinds && (filteredFinds?.length ?? 0) === 0;
  const emptyMain = !isLoading && !hasAnyFinds;
  const hasFilters = !!searchQuery || activeFilter !== "all" || !!filterPeriod || !!filterMaterial || !!filterType || !!filterSession || !!dateFrom || !!dateTo || !!filterPermission;
  const visitName = visit ? `${permissionMap.get(visit.permissionId)?.name || 'Visit'} · ${formatDate(visit.date)}` : 'Visit no longer available';
  const chips = [
    ['q', searchQuery], ['filter', activeFilter === 'top' ? 'Favourites' : activeFilter === 'pending' ? 'Finish later' : ''],
    ['permission', filterPermission ? permissionMap.get(filterPermission)?.name || 'Unknown permission' : ''],
    ['session', filterSession ? visitName : ''], ['period', filterPeriod], ['material', filterMaterial], ['type', filterType],
    ['from', dateFrom ? `From ${dateFrom}` : ''], ['to', dateTo ? `To ${dateTo}` : ''],
  ].filter((entry): entry is [string, string] => !!entry[1]);
  const filterCount = chips.filter(([key]) => key !== 'q' && key !== 'filter').length;
  const openSignal = openSignalId ? undugSignals?.find(signal => signal.id === openSignalId) ?? null : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24">
      <header className="relative mt-4">
        <div>
          <h1 className="m-0 pr-28 text-2xl font-semibold tracking-tight text-gray-950 dark:text-gray-50">Finds</h1>

          <div className="mt-3 flex flex-wrap gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
            <button
              type="button"
              aria-pressed={mainTab === "finds"} onClick={() => setMainTab("finds")}
              className={`min-h-11 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                mainTab === "finds"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Finds
            </button>
            <button
              type="button"
              aria-pressed={mainTab === "significant"} onClick={() => setMainTab("significant")}
              className={`flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                mainTab === "significant"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Significant
              {(significantFinds?.length ?? 0) > 0 && (
                <span className="rounded-full bg-red-500 text-white text-xs font-black w-4 h-4 flex items-center justify-center leading-none">
                  {significantFinds!.length}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-pressed={mainTab === "signals"} onClick={() => setMainTab("signals")}
              className={`flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                mainTab === "signals"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Un-dug signals
              {(undugSignals?.length ?? 0) > 0 && (
                <span className="rounded-full bg-emerald-600 text-white text-xs font-black min-w-4 h-4 px-1 flex items-center justify-center leading-none">
                  {undugSignals!.length}
                </span>
              )}
            </button>
          </div>


        </div>

        {mainTab === "finds" && !emptyMain && (
          <div className="absolute right-0 top-0">
            <button
              type="button"
              onClick={() => navigate("/find?manual=true")}
              className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-emerald-500"
            >
              Add Find
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
            <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-gray-700 dark:bg-gray-800/40">
              <h2 className="mb-2 text-lg font-black text-gray-900 dark:text-gray-100">No significant finds yet</h2>
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

      {mainTab === "signals" && (
        <div className="mt-6 flex flex-col gap-3">
          {!undugSignals && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
                  <div className="h-4 w-1/3 rounded bg-gray-100 dark:bg-gray-700 mb-2" />
                  <div className="h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          )}

          {undugSignals && undugSignals.length === 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-gray-700 dark:bg-gray-800/40">
              <h2 className="mb-2 text-lg font-black text-gray-900 dark:text-gray-100">No un-dug signals</h2>
              <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-gray-400">
                Signals you log without digging will appear here until they are resolved or dismissed.
              </p>
            </div>
          )}

          {undugSignals?.map(signal => {
            const permission = signal.permissionId ? permissionMap.get(signal.permissionId) : undefined;
            const metadata = [
              permission?.name || "No permission linked",
              formatSignalDate(signal.createdAt),
              signal.gpsAccuracy != null ? `GPS +/-${Math.round(signal.gpsAccuracy)}m` : null,
            ].filter(Boolean);
            return (
              <button
                key={signal.id}
                type="button"
                onClick={() => setOpenSignalId(signal.id)}
                className="group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-emerald-800"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
                      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
                      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-sm font-black text-gray-900 transition-colors group-hover:text-emerald-600 dark:text-gray-100 dark:group-hover:text-emerald-400">
                        {signalSummary(signal)}
                      </h2>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        Open
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                      {metadata.map(item => (
                        <span key={item} className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-900/40">
                          {item}
                        </span>
                      ))}
                    </div>
                    {signal.notes && (
                      <p className="mt-2 line-clamp-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        {signal.notes}
                      </p>
                    )}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="mt-3 shrink-0 text-gray-300 transition-colors group-hover:text-emerald-500 dark:text-gray-600">
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {mainTab === "finds" && !emptyMain && (
        <section className="mt-3">
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
                onClick={clearFilters}
                className="min-h-11 rounded-xl border border-gray-200 px-4 text-xs font-black uppercase tracking-wide text-gray-500 transition-colors hover:border-red-300 hover:text-red-600 dark:border-gray-700 dark:text-gray-400"
              >
                Clear all
              </button>
            )}
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['all', 'top', 'pending'] as const).map(value => <button key={value} type="button" aria-pressed={activeFilter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-xl px-2 py-2 text-sm font-medium ${activeFilter === value ? 'bg-emerald-700 text-white' : 'border border-gray-300 dark:border-gray-600'}`}>{value === 'all' ? 'All records' : value === 'top' ? 'Favourites' : 'Finish later'}</button>)}
          </div>
          {chips.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{chips.map(([key, label]) => <button key={key} type="button" className="ui-chip" aria-label={`Remove ${label} filter`} onClick={() => setParam(key, '')}>{label} ×</button>)}</div>}
        </section>
      )}

      {mainTab === 'finds' && <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2" aria-label="Finds view">
          <button type="button" aria-pressed={!mapView} onClick={() => setView('gallery')} className={`min-h-11 rounded-xl border px-4 text-sm ${!mapView ? 'bg-emerald-700 text-white' : 'border-gray-300 dark:border-gray-700'}`}>Gallery</button>
          <button type="button" aria-pressed={mapView} onClick={() => setView('map')} className={`min-h-11 rounded-xl border px-4 text-sm ${mapView ? 'bg-emerald-700 text-white' : 'border-gray-300 dark:border-gray-700'}`}>Map</button>
        </div>
        <button type="button" className="ui-secondary" aria-expanded={filtersOpen} aria-controls="finds-filters" onClick={() => setFiltersOpen(value => !value)}>Filters{filterCount ? ` (${filterCount})` : ''}</button>
        <label className="flex min-w-0 items-center gap-2 text-sm">Sort <select aria-label="Sort finds" className="ui-input" value={sort} onChange={event => setParam('sort', event.target.value)}><option value="newest">Newest found</option><option value="oldest">Oldest found</option><option value="edited">Recently edited</option></select></label>
      </div>}
      {mainTab === 'finds' && filtersOpen && <section id="finds-filters" aria-label="Find filters" className="mt-3 grid gap-3 rounded-xl border border-gray-300 p-3 dark:border-gray-700 sm:grid-cols-2">
        <label className="text-sm">Permission<select className="ui-input" value={filterPermission ?? ''} onChange={e => setParam('permission', e.target.value)}><option value="">All permissions</option>{permissions?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm">Period<select className="ui-input" value={filterPeriod ?? ''} onChange={e => setParam('period', e.target.value)}><option value="">All periods</option>{[...new Set(finds?.map(f => f.period))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Material<select className="ui-input" value={filterMaterial ?? ''} onChange={e => setParam('material', e.target.value)}><option value="">All materials</option>{[...new Set(finds?.map(f => f.material))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Type<input className="ui-input" value={filterType ?? ''} onChange={e => setParam('type', e.target.value)} /></label>
        <label className="text-sm">Found from<input className="ui-input" type="date" value={dateFrom} onChange={e => setParam('from', e.target.value)} /></label>
        <label className="text-sm">Found to<input className="ui-input" type="date" value={dateTo} onChange={e => setParam('to', e.target.value)} /></label>
      </section>}
      {mainTab === 'finds' && invalidDates && <p role="alert" className="ui-error mt-3">Enter valid dates. The end date must be on or after the start date. Open Filters to correct the range.</p>}
      {mainTab === 'finds' && filteredFinds && <p role="status" className="ui-meta mt-3">{filteredFinds.length} {filteredFinds.length === 1 ? 'record' : 'records'}</p>}
      {mainTab === 'finds' && mapView && filteredFinds && <FindsMap key={props.projectId} projectId={props.projectId} finds={filteredFinds} selectedId={selectedId} onOpen={openRecord} onGallery={() => setView('gallery')} />}
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
        <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center dark:border-gray-700 dark:bg-gray-800/40">
          <h2 className="mb-2 text-lg font-black text-gray-900 dark:text-gray-100">No finds yet</h2>
          <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-gray-400">Start a record manually, or use quick capture while detecting.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/find?manual=true")}
              className="min-h-11 rounded-xl bg-emerald-600 px-5 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-emerald-500"
            >
              Add Find
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-5 text-xs font-black uppercase tracking-wide text-gray-600 transition-colors hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
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
            onClick={clearFilters}
            className="mt-3 min-h-11 rounded-xl border border-gray-200 px-5 text-xs font-black uppercase tracking-wide text-gray-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:text-gray-300"
          >
            Clear filters
          </button>
        </div>
      )}

      {mainTab === "finds" && !mapView && !isLoading && !emptyMain && !noMatches && (
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
                  aria-pressed={selectedId === find.id} onClick={() => openRecord(find.id)}
                  className={`group ${selectedId === find.id ? "ring-2 ring-blue-500" : ""} overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:bg-gray-800 ${find.isPending ? "border-amber-300 dark:border-amber-700" : "border-gray-200 hover:border-emerald-200 dark:border-gray-700 dark:hover:border-emerald-800"}`}
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
                      <div className="flex h-full w-full items-center justify-center text-xs font-black uppercase tracking-wide text-gray-300 dark:text-gray-600">
                        No photo
                      </div>
                    )}
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                      <span className="rounded-lg bg-black/65 px-2 py-1 font-mono text-xs font-bold text-white shadow-sm backdrop-blur">
                        {find.findCode}
                      </span>
                      {find.isPending && (
                        <span className="rounded-lg bg-amber-500 px-2 py-1 text-xs font-black uppercase tracking-wide text-white shadow-sm">
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
                      <h2 className="break-words text-base font-black leading-tight text-gray-900 transition-colors group-hover:text-emerald-600 dark:text-gray-100 dark:group-hover:text-emerald-400">
                        {find.objectType || (find.isPending ? "Pending find" : "Unidentified")}
                      </h2>
                      <div className="mt-1 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <span className="truncate">{permission?.name || "No permission"}</span>
                        <span className="shrink-0 opacity-50">-</span>
                        <span className="shrink-0">{formatFindDate(find)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-lg px-2 py-1 text-xs font-black uppercase tracking-wide ${periodClass}`}>
                        {find.period}
                      </span>
                      {find.material !== "Other" && (
                        <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-black uppercase tracking-wide text-gray-600 dark:bg-gray-900 dark:text-gray-300">
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
                className="min-h-11 rounded-xl border border-gray-200 bg-white px-5 text-xs font-black uppercase tracking-wide text-gray-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
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
        <SignificantFindDetailSheet sfId={openSfId} onClose={closeSignificantFind} />
      )}

      {openSignal && (
        <UndugSignalDetailSheet
          signal={openSignal}
          onClose={() => setOpenSignalId(null)}
          onConvertToFind={(signal) => {
            setOpenSignalId(null);
            convertSignalToFind(signal);
          }}
          onShowOnMap={(signal) => {
            setOpenSignalId(null);
            showSignalOnMap(signal);
          }}
        />
      )}

      {mapSignal && (
        <UndugSignalMapSheet
          signal={mapSignal}
          onClose={() => setMapSignal(null)}
          onConvertToFind={(signal) => {
            setMapSignal(null);
            convertSignalToFind(signal);
          }}
        />
      )}
    </div>
  );
}
