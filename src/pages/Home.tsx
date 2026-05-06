import React, { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { getSetting } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";
import { FindModal } from "../components/FindModal";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { enrichPermissions, EnrichedPermission } from "../services/permissions";
import { ClubRallyChoiceModal } from "../components/ClubRallyChoiceModal";

export default function Home(props: {
  projectId: string;
  goPermission: () => void;
  goPermissionWithParam: (type: string) => void;
  goPermissionEdit: (id: string) => void;
  goPermissions: () => void;
  goFind: (permissionId?: string, quickId?: string) => void;
  goAllFinds: () => void;
  goFindsWithFilter: (filter: string) => void;
  goFindsBox: () => void;
  goFieldGuide: () => void;
}) {
  const nav = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [showClubRallyModal, setShowClubRallyModal] = useState(false);
  const [usedActions, setUsedActions] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem('fs_used_actions');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [dismissedNextMoves, setDismissedNextMoves] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem('fs_nextmove_dismissed');
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      // Migrate old array format to timestamp object
      if (Array.isArray(parsed)) {
        const migrated: Record<string, number> = {};
        for (const k of parsed) migrated[k] = Date.now();
        return migrated;
      }
      return parsed;
    } catch { return {}; }
  });

  const dismissNextMove = useCallback((key: string) => {
    setDismissedNextMoves(prev => {
      const next = { ...prev, [key]: Date.now() };
      try { localStorage.setItem('fs_nextmove_dismissed', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const isDismissed = useCallback((key: string, type: string): boolean => {
    if (type === 'active_session') return false;
    const ts = dismissedNextMoves[key];
    if (!ts) return false;
    if (type === 'stale_permission') {
      return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
    }
    return true;
  }, [dismissedNextMoves]);

  const permissions = useLiveQuery(
    async () => {
      let rows = await db.permissions.where("projectId").equals(props.projectId).toArray();

      let enriched = await enrichPermissions(props.projectId, rows);

      // Sort: pinned first, then by session count, then by last session date
      enriched.sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount;
        const bDate = b.lastSessionDate || b.createdAt || "";
        const aDate = a.lastSessionDate || a.createdAt || "";
        return bDate.localeCompare(aDate);
      });

      return enriched;
    },
    [props.projectId]
  );

  const activeSession = useLiveQuery(async () => {
    const sessions = await db.sessions
      .where("projectId").equals(props.projectId)
      .filter(s => !s.isFinished)
      .toArray();
    return sessions.length > 0 ? sessions.sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  }, [props.projectId]);

  const hasOnlyDefault = useMemo(() =>
    !!permissions && permissions.length > 0 && permissions.every(p => p.isDefault),
    [permissions]
  );

  const filteredPermissions = useMemo(() => {
    if (!permissions) return undefined;
    const real = permissions.filter(p => !p.isDefault);
    if (!searchQuery.trim()) return real.slice(0, 3);
    const q = searchQuery.toLowerCase();
    return real
      .filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.landownerName?.toLowerCase().includes(q) ?? false) ||
        (l.notes?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 3);
  }, [permissions, searchQuery]);

  const finds = useLiveQuery(
    async () => db.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const pendingFinds = useMemo(() => finds?.filter(f => f.isPending), [finds]);
  const recentFinds = useMemo(() => finds?.filter(f => !f.isPending), [finds]);

  const appSettings = useLiveQuery(async () => {
    const [detectorist, lastBackupDate] = await Promise.all([
      db.settings.get('detectorist'),
      db.settings.get('lastBackupDate'),
    ]);
    return {
      detectorist: (detectorist?.value as string) || '',
      lastBackupDate: (lastBackupDate?.value as string) || null,
    };
  });

  const nextMoveItems = useMemo(() => {
    const items: Array<{
      type: string;
      dismissKey: string;
      message: string;
      detail?: string;
      cta: string;
      action: () => void;
    }> = [];

    if (activeSession) {
      const sessionPermName = permissions?.find(p => p.id === activeSession.permissionId)?.name;
      items.push({
        type: 'active_session',
        dismissKey: `active_session:${activeSession.id}`,
        message: 'You are currently in an active session',
        detail: sessionPermName ? `Session on: ${sessionPermName}` : undefined,
        cta: 'Resume Session',
        action: () => nav(`/session/${activeSession.id}`),
      });
    }
    if (pendingFinds && pendingFinds.length > 0) {
      items.push({
        type: 'pending',
        dismissKey: `pending:${pendingFinds[0]?.id ?? pendingFinds.length}`,
        message: pendingFinds.length === 1
          ? 'You have a pending find to finish'
          : `You have ${pendingFinds.length} pending finds to finish`,
        cta: 'Finish Records',
        action: () => props.goFindsWithFilter("filter=pending"),
      });
    }
    if (permissions && permissions.length > 0) {
      const now = Date.now();
      const upcomingRallies = permissions
        .filter(p => p.type === "rally" && p.validFrom)
        .map(p => ({ ...p, daysUntil: Math.ceil((new Date(p.validFrom!).getTime() - now) / 86400000) }))
        .filter(p => p.daysUntil >= 0 && p.daysUntil <= 14)
        .sort((a, b) => a.daysUntil - b.daysUntil);
      for (const rally of upcomingRallies) {
        const dayLabel = rally.daysUntil === 0 ? "Today!" : rally.daysUntil === 1 ? "Tomorrow" : `${rally.daysUntil} days away`;
        items.push({
          type: 'upcoming_rally',
          dismissKey: `upcoming_rally:${rally.id}`,
          message: rally.name,
          detail: dayLabel,
          cta: 'View Rally',
          action: () => props.goPermissionEdit(rally.id),
        });
      }
      const stalePerms = permissions.filter(p => {
        if (p.type === "rally") return false;
        if (!p.lastSessionDate) return false;
        const days = (now - new Date(p.lastSessionDate).getTime()) / 86400000;
        return days > 30 && p.cumulativePercent !== null && p.cumulativePercent < 70;
      });
      for (const stale of stalePerms) {
        const days = Math.round((now - new Date(stale.lastSessionDate!).getTime()) / 86400000);
        const covered = Math.round(stale.cumulativePercent!);
        items.push({
          type: 'stale_permission',
          dismissKey: `stale_permission:${stale.id}`,
          message: `${stale.name} is ${covered}% covered`,
          detail: `Not visited in ${days} days`,
          cta: 'Review Permission',
          action: () => props.goPermissionEdit(stale.id),
        });
      }
      const newPerms = permissions.filter(p => p.type !== "rally" && p.sessionCount === 0);
      for (const newPerm of newPerms) {
        items.push({
          type: 'new_permission',
          dismissKey: `new_permission:${newPerm.id}`,
          message: `${newPerm.name} has not been detected yet`,
          cta: 'Start First Session',
          action: () => nav(`/session/new?permissionId=${newPerm.id}`),
        });
      }
    }
    return items;
  }, [pendingFinds, activeSession, permissions, nav, props]);

  const nextMove = nextMoveItems.find(item => !isDismissed(item.dismissKey, item.type)) ?? null;

  const currentYearFindStats = useMemo(() => {
    if (!finds) return null;
    const currentYear = new Date().getFullYear().toString();
    const thisYear = finds.filter(f => !f.isPending && (f.createdAt || "").startsWith(currentYear));
    if (thisYear.length === 0) return null;

    const gold = thisYear.filter(f => f.material === "Gold").length;
    const silver = thisYear.filter(f => f.material === "Silver").length;
    const hammered = thisYear.filter(f =>
      (f.objectType || "").toLowerCase().includes("hammered") ||
      (f.coinType || "").toLowerCase().includes("hammered")
    ).length;

    const periodOrder = ["Prehistoric", "Bronze Age", "Iron Age", "Celtic", "Roman", "Anglo-Saxon", "Early Medieval", "Medieval", "Post-medieval", "Modern", "Unknown"];
    const periodCounts: { period: string; count: number }[] = [];
    for (const period of periodOrder) {
      const count = thisYear.filter(f => f.period === period).length;
      if (count > 0) periodCounts.push({ period, count });
    }

    return { total: thisYear.length, gold, silver, hammered, periodCounts };
  }, [finds]);


  const findIds = useMemo(() => recentFinds?.slice(0, 3).map(s => s.id) ?? [], [recentFinds]);

  const adaptiveActions = useMemo(() => {
    if (!permissions || !appSettings) return [];

    const realPerms = permissions.filter(p => !p.isDefault);
    const totalFinds = finds?.filter(f => !f.isPending).length ?? 0;
    const hasSessions = realPerms.some(p => p.sessionCount > 0);
    const isEstablished = realPerms.length > 0 && totalFinds > 0 && hasSessions;
    const isNewUser = realPerms.length === 0 && totalFinds === 0;

    const backupAge = appSettings.lastBackupDate
      ? (Date.now() - new Date(appSettings.lastBackupDate).getTime()) / 86400000
      : Infinity;
    const backupNeeded = backupAge > 30;
    const nameNotSet = !appSettings.detectorist;
    const permsWithoutBoundary = realPerms.filter(p => !p.boundary && !p.fields?.length);

    // Detect dominant find period (5+ finds required)
    const dominantPeriod = (() => {
      if (!finds || finds.length < 5) return null;
      const counts: Record<string, number> = {};
      for (const f of finds) { if (f.period) counts[f.period] = (counts[f.period] ?? 0) + 1; }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return sorted[0] && sorted[0][1] >= 5 ? sorted[0][0] : null;
    })();

    type Action = { label: string; action: () => void } | null;

    // ── Action pool ──────────────────────────────────────────────────────────
    // Only shown when "Your Next Move" has no content.
    // Each entry is null when its condition isn't met — nulls are filtered out.
    // Add, rotate, or remove entries here to adapt to user behaviour.
    // The first 2 non-null entries are shown; order determines priority.
    const pool: Action[] = isNewUser ? [
      { label: 'Create Permission',    action: props.goPermission },
      { label: 'Scan with FieldGuide', action: props.goFieldGuide },
      { label: 'Search for a Rally',   action: () => setShowClubRallyModal(true) },
    ] : isEstablished ? [
      backupNeeded   ? { label: 'Back Up Your Data',   action: () => nav('/settings') } : null,
      nameNotSet     ? { label: 'Set Your Name',        action: () => nav('/settings') } : null,
      permsWithoutBoundary.length > 0
                     ? { label: 'Add a Field Boundary', action: () => nav(`/permission/${permsWithoutBoundary[0].id}`) } : null,
      dominantPeriod ? { label: `View ${dominantPeriod} Finds`, action: () => props.goFindsWithFilter(`period=${dominantPeriod}`) } : null,
      totalFinds >= 10
                     ? { label: 'Export to CSV',        action: () => nav('/settings') } : null,
      realPerms.length > 0
                     ? { label: 'Share a Permission',   action: () => setShowClubRallyModal(true) } : null,
      { label: 'Search for a Rally',   action: () => setShowClubRallyModal(true) },
      { label: 'Scan with FieldGuide', action: props.goFieldGuide },
    ] : [
      { label: 'Record Find',          action: () => props.goFind() },
      { label: 'Scan with FieldGuide', action: props.goFieldGuide },
      { label: 'Create Permission',    action: props.goPermission },
    ];
    // ────────────────────────────────────────────────────────────────────────

    return (pool.filter(Boolean) as NonNullable<Action>[])
      .filter(a => !usedActions.has(a.label))
      .slice(0, 2)
      .map(a => ({
        ...a,
        action: () => {
          try {
            const stored = sessionStorage.getItem('fs_used_actions');
            const current: string[] = stored ? JSON.parse(stored) : [];
            sessionStorage.setItem('fs_used_actions', JSON.stringify([...current, a.label]));
          } catch {}
          setUsedActions(prev => new Set(prev).add(a.label));
          a.action();
        },
      }));
  }, [permissions, finds, appSettings, usedActions, nav, props]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await db.media.where("findId").anyOf(findIds).toArray();
    const m = new Map<string, Media>();
    media.sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of media) {
        if (row.findId && !m.has(row.findId)) m.set(row.findId, row);
    }
    return m;
  }, [findIds]);

  return (
    <div className="grid gap-6 max-w-5xl mx-auto overflow-hidden px-4 pb-20 mt-4">
      <button
        onClick={() => setPrivacyExpanded(v => !v)}
        className="flex items-center justify-center gap-2 py-1 px-1 w-full text-left opacity-40 hover:opacity-60 transition-opacity"
      >
        <span className="text-xs shrink-0">🔒</span>
        {privacyExpanded ? (
          <p className="text-xs font-normal text-black dark:text-white m-0">
            Your data is private. All find spots, GPS coordinates, and landowner details are stored locally on this device. Nothing is ever uploaded or shared. No subscriptions. No accounts. Your data stays on this device.
          </p>
        ) : (
          <span className="text-xs font-normal text-black dark:text-white">Your data is private · No subscriptions · No accounts</span>
        )}
      </button>

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 m-0">Today</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Continue where you left off</p>
        </div>
      </section>

      {nextMove ? (
        <div className={`relative rounded-2xl p-4 pr-7 flex items-center justify-between gap-4 ${nextMove.type === 'upcoming_rally' ? 'bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800' : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'}`}>
          {nextMove.type !== 'active_session' && (
            <button
              onClick={() => dismissNextMove(nextMove.dismissKey)}
              className="absolute top-1.5 right-1.5 w-4 h-4 p-0 flex items-center justify-center leading-none text-red-500 hover:text-red-600 transition-colors text-base outline-none border-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black mb-1 ${
              nextMove.type === 'active_session'
                ? 'uppercase tracking-widest text-amber-600 dark:text-amber-400'
                : 'uppercase tracking-widest ' + (nextMove.type === 'upcoming_rally' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')
            }`}>
              {nextMove.type === 'active_session' ? 'Session in progress' : nextMove.type === 'upcoming_rally' ? 'Upcoming Rally' : 'Your next move'}
            </p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-snug">{nextMove.message}</p>
            {'detail' in nextMove && nextMove.detail && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{nextMove.detail}</p>
            )}
          </div>
          <button
            onClick={nextMove.action}
            className={`shrink-0 text-white text-xs font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all whitespace-nowrap ${nextMove.type === 'upcoming_rally' ? 'bg-amber-500 hover:bg-amber-400 shadow-sm shadow-amber-500/20' : 'bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-600/20'}`}
          >
            {nextMove.cta}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl p-4 flex items-center gap-3 overflow-hidden bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {adaptiveActions.map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className="shrink-0 px-4 py-2.5 rounded-full text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 hover:border-emerald-400 dark:hover:border-emerald-500 transition-all active:scale-[0.98] whitespace-nowrap"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}


      {hasOnlyDefault && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
          <div>
            <p className="text-xs font-bold text-gray-600 dark:text-gray-300">
              Start with FieldGuide
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-0.5">
              Scan the land before setting up permissions. Find where activity likely was, then record properly when you're ready.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={props.goFieldGuide}
              className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-xl hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all whitespace-nowrap"
            >
              Open FieldGuide
            </button>
            <button
              onClick={props.goPermission}
              className="text-xs font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2 rounded-xl hover:border-emerald-400 transition-all whitespace-nowrap"
            >
              Add Permission
            </button>
          </div>
        </div>
      )}

      {pendingFinds && pendingFinds.length > 0 && nextMove?.type !== 'pending' && (
        <button
          onClick={() => props.goFindsWithFilter("filter=pending")}
          className="flex items-center justify-between gap-4 w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <span className="animate-pulse opacity-80 text-sm">🟠</span>
            <span className="text-sm font-black text-amber-700 dark:text-amber-400">
              {pendingFinds.length} pending {pendingFinds.length === 1 ? 'find' : 'finds'}
            </span>
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 shrink-0">
            View Queue →
          </span>
        </button>
      )}

      {currentYearFindStats && (
        <section className="min-w-0 overflow-hidden">
          <button onClick={props.goFindsBox} className="flex items-baseline justify-between w-full mb-2 hover:opacity-70 transition-opacity">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Finds {new Date().getFullYear()}</h3>
            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">{currentYearFindStats.total} Total</span>
          </button>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1 [mask-image:linear-gradient(to_right,black_0,black_calc(100%-48px),transparent_100%)]" title="Scroll to see more">

            {currentYearFindStats.gold > 0 && (
              <button onClick={() => props.goFindsWithFilter("material=Gold")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg px-3 py-1.5 hover:border-yellow-500 transition-colors shrink-0">
                <span className="text-sm font-black text-yellow-700 dark:text-yellow-400">{currentYearFindStats.gold}</span>
                <span className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">Gold</span>
              </button>
            )}
            {currentYearFindStats.silver > 0 && (
              <button onClick={() => props.goFindsWithFilter("material=Silver")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-slate-100 dark:bg-slate-400/10 border border-blue-200 dark:border-blue-400/30 rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors shrink-0 shadow-[0_0_8px_rgba(148,163,184,0.3)]">
                <span className="text-sm font-black text-slate-500 dark:text-slate-200">{currentYearFindStats.silver}</span>
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">Silver</span>
              </button>
            )}
            {currentYearFindStats.hammered > 0 && (
              <button onClick={() => props.goFindsWithFilter("type=Hammered")} className="whitespace-nowrap flex items-baseline gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:border-emerald-500 transition-colors shadow-sm shrink-0">
                <span className="text-sm font-black text-gray-800 dark:text-gray-100">{currentYearFindStats.hammered}</span>
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Hammered</span>
              </button>
            )}
            {currentYearFindStats.periodCounts.length > 0 && (currentYearFindStats.gold > 0 || currentYearFindStats.silver > 0 || currentYearFindStats.hammered > 0) && (
              <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch mx-1 shrink-0" />
            )}
            {currentYearFindStats.periodCounts.map(({ period, count }) => (
              <button key={period} onClick={() => props.goFindsWithFilter(`period=${period}`)} className="whitespace-nowrap flex items-baseline gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 hover:border-emerald-500 transition-colors shadow-sm shrink-0">
                <span className="text-sm font-black text-gray-800 dark:text-gray-100">{count}</span>
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">{period}</span>
              </button>
            ))}
          </div>
          {(currentYearFindStats.periodCounts.length + (currentYearFindStats.gold > 0 ? 1 : 0) + (currentYearFindStats.silver > 0 ? 1 : 0) + (currentYearFindStats.hammered > 0 ? 1 : 0)) > 4 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic ml-1 mt-1">Scroll for more</p>
          )}
        </section>
      )}

      <div
        className="flex items-center gap-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-md hover:shadow-lg hover:scale-[1.008] hover:-translate-y-px transition-all duration-200 ease-out cursor-pointer group"
        onClick={props.goFieldGuide}
      >
        <svg width="40" height="40" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <defs>
            <linearGradient id="fg-card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fcd34d" />
              <stop offset="50%" stopColor="#fb923c" />
              <stop offset="100%" stopColor="#f87171" />
            </linearGradient>
          </defs>
          <circle cx="256" cy="256" r="180" stroke="url(#fg-card-grad)" strokeWidth="24" fill="none" />
          <circle cx="256" cy="256" r="100" stroke="url(#fg-card-grad)" strokeWidth="22" fill="none" opacity="0.45" />
          <circle cx="256" cy="256" r="40" fill="url(#fg-card-grad)" />
          <rect x="244" y="40" width="24" height="70" rx="4" fill="url(#fg-card-grad)" opacity="0.18" />
          <rect x="244" y="402" width="24" height="70" rx="4" fill="url(#fg-card-grad)" opacity="0.18" />
          <rect x="40" y="244" width="70" height="24" rx="4" fill="url(#fg-card-grad)" opacity="0.18" />
          <rect x="402" y="244" width="70" height="24" rx="4" fill="url(#fg-card-grad)" opacity="0.18" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="font-black text-gray-800 dark:text-gray-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">FieldGuide</div>
          <div className="text-[11px] text-gray-500/80 dark:text-gray-400/80 mt-0.5 leading-snug tracking-[0.01em]">Understand the landscape before you dig</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); props.goFieldGuide(); }}
          className="shrink-0 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all"
        >
          Open
        </button>
      </div>

      <section className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
            <div className="flex items-baseline gap-4">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">Permissions</h2>
                <button onClick={props.goPermissions} className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all">View All →</button>
            </div>
            <div className="flex items-center gap-3 w-full md:max-w-md">
                <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40">🔍</span>
                    <input
                        type="text"
                        placeholder="Search permissions..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                        }}
                        className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-2 pl-9 pr-4 text-sm focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.1)] outline-none transition-all"
                    />
                </div>
                <div className="text-sm text-gray-500 font-mono hidden sm:block whitespace-nowrap">{permissions?.filter(p => !p.isDefault).length ?? 0} total</div>

            </div>
        </div>
        
        {(!filteredPermissions || filteredPermissions.length === 0) && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 p-8 rounded-2xl border-2 border-dashed border-emerald-200 dark:border-emerald-800 text-center animate-in zoom-in-95 duration-500">
                {searchQuery ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">No results found matching your search.</p>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <p className="text-sm text-emerald-800 dark:text-emerald-300 font-bold">No real permissions yet.</p>
                        <p className="text-sm text-emerald-700/70 dark:text-emerald-400/80 max-w-md">Start with FieldGuide to understand the land, or add a permission if you already have access.</p>
                        <button onClick={props.goFieldGuide} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest shadow-lg active:translate-y-1 transition-all text-sm">
                            Open FieldGuide
                        </button>
                        <button onClick={props.goPermission} className="text-emerald-700 dark:text-emerald-400 text-sm font-bold hover:underline">
                            Add permission instead →
                        </button>
                    </div>
                )}
            </div>
        )}
        
        {filteredPermissions && filteredPermissions.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPermissions.map((l) => (
              <div key={l.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-lg hover:-translate-y-[1px] hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 ease-out flex flex-col h-full group relative overflow-hidden cursor-pointer" onClick={() => props.goPermissionEdit(l.id)}>
                {l.type === 'rally' && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[8px] font-black px-2 py-1 rounded-bl uppercase tracking-widest z-10">Rally</div>}
                
                {/* Header */}
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="min-w-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); props.goPermissionEdit(l.id); }}
                        className="text-gray-900 dark:text-white truncate text-lg font-black group-hover:text-emerald-600 dark:group-hover:text-emerald-400 text-left transition-colors leading-tight"
                    >
                        {l.name || "(Unnamed)"}
                    </button>
                    {l.createdAt && (
                        <div className="text-xs opacity-60 font-mono mt-0.5">
                            {new Date(l.createdAt).toLocaleDateString()}
                        </div>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs font-semibold text-amber-500 dark:text-amber-400 whitespace-nowrap shrink-0 bg-transparent border border-amber-200/50 dark:border-amber-700/50 px-1.5 py-0.5 rounded-md">
                    <span className="text-[8px]">◈</span>{l.findCount} <span className="opacity-50">finds</span>
                  </span>
                </div>

                {/* Satellite Preview with Progress Overlay */}
                <div className="relative aspect-video -mx-4 mb-4 overflow-hidden rounded-lg">
                    <StaticMapPreview
                        lat={l.lat}
                        lon={l.lon}
                        boundary={l.boundary || l.fields?.[0]?.boundary}
                        tracks={l.tracks}
                        className="h-full w-full rounded-none"
                    />

                    {l.cumulativePercent !== null && (
                        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                            <div className="px-2 py-1 rounded-lg backdrop-blur-md border border-white/20 bg-black/50 shadow-md flex flex-col items-center">
                                <span className="text-[8px] font-black uppercase leading-none opacity-60 mb-0.5">Undetected</span>
                                <span className={`text-xs font-black leading-none ${l.cumulativePercent < 90 ? 'text-orange-400' : 'text-emerald-400'}`}>{Math.round(100 - l.cumulativePercent)}%</span>
                            </div>
                        </div>
                    )}

                    <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm border border-white/20 px-1.5 py-0.5 rounded text-[8px] font-mono text-white/60">
                        {l.lat != null && l.lon != null ? `${l.lat.toFixed(3)}, ${l.lon.toFixed(3)}` : "No GPS"}
                    </div>
                </div>
                
                <div className="grid gap-2 mb-4 flex-1">
                  {l.landownerName && <div className="text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1.5 italic">👤 {l.landownerName}</div>}
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                        {l.sessionCount} {l.sessionCount === 1 ? 'Visit' : 'Visits'}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {l.totalAcres !== null && (
                        <div className="text-xs font-bold text-emerald-700/70 dark:text-emerald-400/80">{l.totalAcres.toFixed(1)} acres</div>
                      )}
                      {l.landType && <div className="text-xs font-medium opacity-70 uppercase tracking-tighter">{l.landType}</div>}
                    </div>
                  </div>
                </div>
                
                <div className="pt-3 mt-auto border-t border-gray-200 dark:border-gray-700 flex gap-2 items-center">
                  <button onClick={(e) => { e.stopPropagation(); props.goFind(l.id); }} className="flex-1 bg-emerald-600/90 dark:bg-emerald-700/90 text-white text-xs font-black py-1.5 rounded-lg hover:bg-emerald-500 dark:hover:bg-emerald-600 transition-all duration-200 ease-out uppercase tracking-wider shadow-sm">
                    Add find
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); props.goPermissionEdit(l.id); }} className="px-3 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs font-bold py-1.5 rounded-lg transition-all duration-200 ease-out border border-gray-200 dark:border-gray-700 uppercase">
                    View
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); db.permissions.update(l.id, { isPinned: !l.isPinned }).catch(console.error); }}
                    title={l.isPinned ? "Unpin" : "Pin to top"}
                    className={`px-2 py-1.5 rounded-lg text-[13px] transition-all duration-200 ease-out border ${l.isPinned ? "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700" : "bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700 opacity-40 hover:opacity-100"}`}
                  >
                    📌
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Latest Finds</h2>
            <button onClick={props.goAllFinds} className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all">View All Finds →</button>
        </div>

        {(!recentFinds || recentFinds.length === 0) && (
          <div className="bg-gray-50 dark:bg-gray-800/50 p-8 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center">
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">No finds recorded yet.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">When you record your first find, it will appear here.</p>
            <button onClick={() => props.goFind()} className="mt-4 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-sm font-black transition-colors">Record First Find</button>
          </div>
        )}
        
        {recentFinds && recentFinds.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentFinds.slice(0, 3).map((s) => {
              const media = firstMediaMap?.get(s.id);
              return (
                <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-md hover:shadow-lg hover:-translate-y-[1px] transition-all duration-200 ease-out flex flex-col h-full group cursor-pointer" onClick={() => setOpenFindId(s.id)}>
                  <div className="aspect-square bg-gray-100 dark:bg-gray-900 relative">
                    {media ? (
                      <ScaledImage
                        media={media}
                        className="w-full h-full"
                        imgClassName="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center opacity-30 italic text-[10px]">
                        No photo
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                        <strong className="text-white font-mono text-[9px] bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded uppercase tracking-tighter">{s.findCode}</strong>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="font-bold text-gray-800 dark:text-gray-200 truncate leading-tight group-hover:text-emerald-600 transition-colors" title={s.objectType}>{s.objectType || "(Object TBD)"}</div>
                    <div className="opacity-60 text-[10px] mt-1.5 flex justify-between items-center">
                      <div className="flex gap-2">
                        <span className="bg-gray-50 dark:bg-gray-900 px-1 rounded border border-gray-200 dark:border-gray-700 uppercase font-bold">{s.period}</span>
                        {s.material !== "Other" && <span className="capitalize">{s.material}</span>}
                      </div>
                      <span className="opacity-60">{new Date(s.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {openFindId && (
        <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
      )}

      {showClubRallyModal && (
        <ClubRallyChoiceModal
          onClose={() => setShowClubRallyModal(false)}
          onSolo={() => { setShowClubRallyModal(false); props.goPermissionWithParam("rally"); }}
          onJoinUrl={(url) => { setShowClubRallyModal(false); nav(url); }}
          onOrganiseNew={() => { setShowClubRallyModal(false); nav("/permission?type=rally&organiserSetup=true"); }}
          onOrganiseExisting={(id) => { setShowClubRallyModal(false); nav(`/permission/${id}?openClubDay=true`); }}
          permissions={(permissions || [])
            .filter(p => !p.isClubDayMember && !p.isDefault)
            .map(p => ({ id: p.id, name: p.name, type: p.type }))}
        />
      )}
    </div>
  );
}
