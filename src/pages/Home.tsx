import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import type { Media } from "../db";
import { pagePersistence } from "../services/pagePersistence";
import { getSetting } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";
import { enrichPermissions } from "../services/permissions";
import { PermissionCard } from "../components/PermissionCard";
import { deriveTreasureClock, TreasureClockItem } from "../services/treasureClock";
import { ClubRallyChoiceModal } from "../components/ClubRallyChoiceModal";
import { Modal } from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmModal";
import { UndugSignalSheet } from "../components/UndugSignalSheet";
import { LockIcon, SearchIcon } from "../components/AppIcons";
import { ephemeralSession, useDurableSetting } from '../services/clientStorage';
import { getBackupReminderState } from '../services/backupReminder';
import { setPermissionPinned } from '../services/permissionMutations';
import { reportNonFatal } from '../services/diagLog';
import { getHomeContext } from '../services/home/homeContext';
import { resolveContinuityForPermission } from '../services/continuity/continuityResolver';
import { sessionStartedAt } from '../services/session/activeSessionContext';
import { SignalMarkerIcon } from '../components/SignalMarkerIcon';

const FindModal = React.lazy(() =>
  import("../components/FindModal").then((mod) => ({ default: mod.FindModal }))
);

const CLUB_RALLY_HOME_CARD_DISMISSED_KEY = "fs_club_rally_home_card_dismissed";

export default function Home(props: {
  projectId: string;
  isStandalone: boolean;
  promptInstall: () => Promise<boolean>;
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
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [clubRallyCardDismissed, setClubRallyCardDismissed] = useDurableSetting(CLUB_RALLY_HOME_CARD_DISMISSED_KEY, false);
  const [installNextStepDismissed, setInstallNextStepDismissed] = useState(() => {
    try {
      return ephemeralSession.get('fs_install_next_step_dismissed') === 'true';
    } catch { return false; }
  });
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [showHomeSignalSheet, setShowHomeSignalSheet] = useState(false);
  const [homeSignalToast, setHomeSignalToast] = useState<{ openCount: number } | null>(null);
  const homeSignalToastTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => { if (homeSignalToastTimerRef.current !== null) window.clearTimeout(homeSignalToastTimerRef.current); };
  }, []);
  const dismissInstallNextStep = useCallback(() => {
    try {
      ephemeralSession.set('fs_install_next_step_dismissed', 'true');
    } catch (error) {
      reportNonFatal('home', 'Install prompt dismissal save failed', error);
    }
    setInstallNextStepDismissed(true);
  }, []);

  const dismissClubRallyCard = useCallback(async () => {
    const confirmed = await confirmAction({
      title: "Hide Club / Rally Shortcut?",
      message: "This will remove the Run a club dig or rally shortcut from your Home screen on this device.\n\nYou can still create or open rallies from Permissions.",
      confirmLabel: "Hide Shortcut",
      cancelLabel: "Keep It",
    });
    if (!confirmed) return;
    setClubRallyCardDismissed(true);
  }, [confirmAction]);

  const closeInstallGuide = useCallback(() => {
    setShowInstallGuide(false);
    dismissInstallNextStep();
  }, [dismissInstallNextStep]);

  const offerInstall = useCallback(() => {
    props.promptInstall().then(prompted => {
      if (prompted) dismissInstallNextStep();
      else setShowInstallGuide(true);
    });
  }, [dismissInstallNextStep, props.promptInstall]);

  const permissions = useLiveQuery(
    async () => {
      let rows = await pagePersistence.permissions.where("projectId").equals(props.projectId).toArray();

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

  const homeContext = useLiveQuery(
    () => getHomeContext(props.projectId),
    [props.projectId],
  );
  const activeSession = homeContext?.active.session ?? null;
  const returnContext = homeContext?.returnTo ?? null;
  const [continuityEnabled] = useDurableSetting('fs_v5_continuity_preview', true);
  const continuityItem = useLiveQuery(
    () => continuityEnabled && returnContext && returnContext.reason !== 'active-session'
      ? resolveContinuityForPermission(returnContext.permission.id)
      : Promise.resolve(null),
    [continuityEnabled, returnContext?.permission.id, returnContext?.reason],
  );

  const treasureClock = useLiveQuery(
    () => deriveTreasureClock(props.projectId, new Date()),
    [props.projectId],
  );

  const realPermissions = useMemo(
    () => permissions?.filter(p => !p.isDefault) ?? [],
    [permissions]
  );

  const filteredPermissions = useMemo(() => {
    if (!permissions) return undefined;
    if (!searchQuery.trim()) return realPermissions.slice(0, 3);
    const q = searchQuery.toLowerCase();
    return realPermissions
      .filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.landownerName?.toLowerCase().includes(q) ?? false) ||
        (l.notes?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 3);
  }, [permissions, realPermissions, searchQuery]);

  const finds = useLiveQuery(
    async () => pagePersistence.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const pendingFinds = useMemo(() => finds?.filter(f => f.isPending), [finds]);
  const recentFinds = useMemo(() => finds?.filter(f => !f.isPending && !f.scatterId && !f.isNotableFind), [finds]);
  const completedFindCount = recentFinds?.length ?? 0;
  const isFirstRun = !!permissions && realPermissions.length === 0 && completedFindCount === 0;

  const appSettings = useLiveQuery(async () => {
    const detectorist = await pagePersistence.settings.get('detectorist');
    return {
      detectorist: (detectorist?.value as string) || '',
    };
  });
  const backupReminder = useLiveQuery(() => getBackupReminderState());

  const reportingMove = useMemo(() => {
    const most = treasureClock?.[0];
    if (!most) return null;
    return {
      message: most.jurisdiction === 'scotland'
        ? `${most.permissionName}: significant find recorded`
        : `${most.permissionName}: significant find recorded ${most.daysElapsed} days ago`,
      action: () => nav(`/finds-box?tab=significant&sf=${most.sfId}`),
    };
  }, [nav, treasureClock]);
  const backupCanSurface = (homeContext?.completedSessionCount ?? 0) > 0;
  const contextualBackup = backupCanSurface && backupReminder?.level !== 'none'
    ? backupReminder
    : null;

  const installPlatform = useMemo(() => {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }, []);

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

    const realPerms = realPermissions;
    const totalFinds = finds?.filter(f => !f.isPending).length ?? 0;
    const hasSessions = realPerms.some(p => p.sessionCount > 0);
    const isEstablished = realPerms.length > 0 && totalFinds > 0 && hasSessions;
    const isNewUser = realPerms.length === 0 && totalFinds === 0;

    const backupNeeded = backupReminder !== undefined && backupReminder.level !== 'none';
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

    type Action = { label: string; mobileLabel?: string; action: () => void } | null;

    // ── Action pool ──────────────────────────────────────────────────────────
    // Only shown when "Your Next Move" has no content.
    // Each entry is null when its condition isn't met — nulls are filtered out.
    // Keep the order stable so frequent actions do not move after a tap.
    const pool: Action[] = isNewUser ? [
      { label: 'Create Permission',    mobileLabel: 'Permission', action: props.goPermission },
      { label: 'Scan with Field Guide', mobileLabel: 'Field Guide',  action: props.goFieldGuide },
      { label: 'Discover Rallies',     mobileLabel: 'Rallies',     action: () => nav('/discover') },
    ] : isEstablished ? [
      backupNeeded   ? { label: 'Back Up Your Data',   mobileLabel: 'Back Up',       action: () => nav('/settings') } : null,
      nameNotSet     ? { label: 'Set Your Name',        mobileLabel: 'Set Name',      action: () => nav('/settings') } : null,
      permsWithoutBoundary.length > 0
                     ? { label: 'Add a Field Boundary', mobileLabel: 'Add Boundary',  action: () => nav(`/permission/${permsWithoutBoundary[0].id}`) } : null,
      dominantPeriod ? { label: `View ${dominantPeriod} Finds`, mobileLabel: `${dominantPeriod} Finds`, action: () => props.goFindsWithFilter(`period=${dominantPeriod}`) } : null,
      totalFinds >= 10
                     ? { label: 'Export to CSV',        mobileLabel: 'Export CSV',    action: () => nav('/settings') } : null,
      realPerms.length > 0
                     ? { label: 'Share a Permission',   mobileLabel: 'Share',         action: () => setShowClubRallyModal(true) } : null,
      { label: 'Discover Rallies',     mobileLabel: 'Rallies', action: () => nav('/discover') },
      { label: 'Scan with Field Guide', mobileLabel: 'Field Guide',  action: props.goFieldGuide },
    ] : [
      { label: 'Record Find',          action: () => props.goFind() },
      { label: 'Scan with Field Guide', mobileLabel: 'Field Guide',  action: props.goFieldGuide },
      { label: 'Create Permission',    mobileLabel: 'Permission',  action: props.goPermission },
    ];
    // ────────────────────────────────────────────────────────────────────────

    return (pool.filter(Boolean) as NonNullable<Action>[]).slice(0, 8);
  }, [permissions, realPermissions, finds, appSettings, backupReminder, nav, props]);

  const firstMediaMap = useLiveQuery(async () => {
    if (findIds.length === 0) return new Map<string, Media>();
    const media = await pagePersistence.media.where("findId").anyOf(findIds).toArray();
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

  const homePresentationReady = permissions !== undefined && finds !== undefined && homeContext !== undefined;
  if (!homePresentationReady) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading Home"
        className="mx-auto min-h-[calc(100vh-220px)] max-w-5xl px-4"
      >
        <span className="sr-only" role="status">Loading Home…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-4 grid w-full min-w-0 max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 overflow-hidden px-4 pb-20">
      {showHomeSignalSheet && activeSession && (
        <UndugSignalSheet
          sessionId={activeSession.id}
          permissionId={activeSession.permissionId}
          onSaved={(_id, openCount) => {
            setShowHomeSignalSheet(false);
            setHomeSignalToast({ openCount });
            if (homeSignalToastTimerRef.current !== null) window.clearTimeout(homeSignalToastTimerRef.current);
            homeSignalToastTimerRef.current = window.setTimeout(() => setHomeSignalToast(null), 4000);
          }}
          onClose={() => setShowHomeSignalSheet(false)}
        />
      )}
      {homeSignalToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] bg-gray-950/95 backdrop-blur-md text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2 border border-emerald-500/30 animate-in slide-in-from-top-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0 text-emerald-300">
            <SignalMarkerIcon className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs text-emerald-100">
            {homeSignalToast.openCount > 0
              ? `Signal logged · ${homeSignalToast.openCount} open on this permission`
              : 'Signal logged'}
          </span>
        </div>
      )}
      <div className="flex items-start justify-center gap-2 px-1 text-gray-600 dark:text-gray-300">
        <button
          onClick={() => setPrivacyExpanded(v => !v)}
          className="flex min-w-0 items-start justify-center gap-2 py-1 text-left transition-colors hover:text-gray-800 dark:hover:text-gray-100"
        >
          <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {privacyExpanded ? (
            <span className="text-xs font-normal">
              Your saved finds, GPS coordinates, photos and landowner details stay on this device unless you export or share them. Online features may request map tiles, search results or landscape data for the area you are viewing; Discover only sends details you type into its submit forms.
            </span>
          ) : (
            <span className="text-xs font-normal">Local-first storage · No subscriptions · No accounts</span>
          )}
        </button>
        {contextualBackup?.level === 'recommended' && !privacyExpanded && (
          <button
            type="button"
            onClick={() => nav('/settings')}
            className="shrink-0 rounded-full border border-teal-700/40 px-2 py-1 text-2xs font-black uppercase tracking-wide text-teal-700 dark:text-teal-300"
          >
            Back up
          </button>
        )}
        {!props.isStandalone && !installNextStepDismissed && contextualBackup?.level !== 'recommended' && !privacyExpanded && (
          <button
            type="button"
            onClick={offerInstall}
            className="shrink-0 rounded-full border border-teal-700/40 px-2 py-1 text-2xs font-black uppercase tracking-wide text-teal-700 dark:text-teal-300"
          >
            Install
          </button>
        )}
      </div>

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 m-0">Today</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Continue where you left off</p>
        </div>
      </section>

      {isFirstRun ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900/70 dark:bg-sky-950/15">
          <div className="mb-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-sky-700 dark:text-sky-300">Start here</p>
              <h3 className="mt-1 text-base font-black text-gray-900 dark:text-gray-100">Build your first field record</h3>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Save permission", detail: "Add land details.", action: props.goPermission, active: true },
              { label: "Scan land", detail: "Read the area.", action: props.goFieldGuide, active: false },
              { label: "Record find", detail: "Start a find record.", action: () => props.goFind(), active: false },
              { label: "Back up", detail: "Protect local data.", action: () => nav('/settings'), active: false },
            ].map((item, index) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`min-h-14 rounded-xl border px-3 py-2 text-left transition-colors ${
                  item.active
                    ? "border-sky-500 bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
                    : "border-gray-200 bg-white/70 text-gray-700 hover:border-sky-400 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200"
                }`}
              >
                <span className="block text-[10px] font-black uppercase tracking-widest text-sky-600 dark:text-sky-400">Step {index + 1}</span>
                <span className="mt-0.5 block text-sm font-black leading-tight">{item.label}</span>
                <span className="mt-0.5 block text-2xs leading-tight text-gray-500 dark:text-gray-400">{item.detail}</span>
              </button>
            ))}
          </div>
        </section>
      ) : activeSession ? (
        <div className="relative w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-teal-600/50 bg-gradient-to-br from-teal-950 to-gray-950 p-4 text-white shadow-lg shadow-teal-950/20">
          <div className="absolute inset-y-0 left-0 w-1 bg-teal-400" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-2xs font-black uppercase tracking-[0.18em] text-teal-300">
                <span className="h-2 w-2 rounded-full bg-teal-400 shadow-[0_0_0_4px_rgba(45,212,191,0.14)]" />
                Detecting now
              </div>
              <p className="truncate text-base font-black">
                {returnContext?.permission.name ?? 'Active session'}
              </p>
              <p className="mt-0.5 text-xs text-gray-300">
                Started {new Date(sessionStartedAt(activeSession)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => nav(`/session/${activeSession.id}`)}
              className="min-h-11 shrink-0 rounded-xl bg-teal-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-950 shadow-sm hover:bg-teal-400"
            >
              Resume
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => nav(`/find?permissionId=${activeSession.permissionId}&sessionId=${activeSession.id}&mode=quick${activeSession.fieldId ? `&fieldId=${activeSession.fieldId}` : ''}`)}
              className="min-h-11 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-gray-950 hover:bg-amber-400"
            >
              Quick Find
            </button>
            <button
              type="button"
              onClick={() => setShowHomeSignalSheet(true)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-teal-400/30 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-wider text-teal-100 hover:bg-white/10"
            >
              <SignalMarkerIcon className="h-3.5 w-3.5" /> Log Signal
            </button>
          </div>
        </div>
      ) : returnContext ? (
        <button
          type="button"
          onClick={() => nav(continuityItem?.action.href ?? `/permission/${returnContext.permission.id}`)}
          className="group flex min-h-[76px] w-full min-w-0 max-w-full items-center gap-3 rounded-2xl border border-teal-800/50 bg-gradient-to-r from-gray-950 to-teal-950 px-3 py-2 text-left text-white shadow-md transition-transform active:scale-[0.99]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-teal-400/25 bg-teal-400/10 text-xl text-teal-300" aria-hidden="true">↩</span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xs font-black uppercase tracking-[0.18em] text-teal-300">Return to</span>
            <span className="mt-0.5 block truncate text-base font-black">{returnContext.permission.name}</span>
            <span className="mt-1 block truncate text-xs text-gray-300">
              {continuityItem
                ? `${continuityItem.title} · ${continuityItem.explanation}`
                : returnContext.lastVisitAt
                  ? `Last visit ${new Date(returnContext.lastVisitAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
                  : 'Open permission'}
            </span>
          </span>
          <span className="shrink-0 text-lg text-teal-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
        </button>
      ) : (
        <div className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {adaptiveActions.slice(0, showMoreActions ? adaptiveActions.length : 2).map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-gray-700 transition-all active:scale-[0.98] dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-200 hover:border-emerald-400 dark:hover:border-emerald-500 sm:shrink-0 sm:rounded-full sm:px-4 sm:py-2.5 sm:text-sm sm:font-medium sm:normal-case sm:tracking-normal"
              >
                <span className="sm:hidden">{item.mobileLabel ?? item.label}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
            {adaptiveActions.length > 2 && (
              <button
                type="button"
                aria-expanded={showMoreActions}
                onClick={() => setShowMoreActions(current => !current)}
                className="min-h-11 min-w-0 rounded-xl border border-dashed border-gray-300 px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-gray-500 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-gray-600 dark:text-gray-300 dark:hover:border-emerald-500 dark:hover:text-emerald-300 sm:shrink-0 sm:rounded-full sm:px-4 sm:text-sm sm:normal-case sm:tracking-normal"
              >
                {showMoreActions ? 'Less' : `More (${adaptiveActions.length - 2})`}
              </button>
            )}
          </div>
        </div>
      )}

      {reportingMove ? (
        <button
          type="button"
          onClick={reportingMove.action}
          className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left ${
            treasureClock?.[0]?.tier === 'red' || treasureClock?.[0]?.tier === 'overdue'
              ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/15'
              : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/15'
          }`}
        >
          <span className="min-w-0">
            <span className="block text-2xs font-black uppercase tracking-widest text-red-700 dark:text-red-300">Reporting obligation</span>
            <span className="block truncate text-sm font-bold text-gray-900 dark:text-gray-100">{reportingMove.message}</span>
          </span>
          <span className="shrink-0 text-xs font-black uppercase tracking-wider text-red-700 dark:text-red-300">Review</span>
        </button>
      ) : contextualBackup && (contextualBackup.level === 'important' || contextualBackup.level === 'urgent') ? (
        <button
          type="button"
          onClick={() => nav('/settings')}
          className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left ${
            contextualBackup.level === 'urgent'
              ? 'border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-900/15'
              : 'border-teal-500 bg-gray-50 dark:border-teal-800 dark:bg-gray-800/70'
          }`}
        >
          <span>
            <span className="block text-2xs font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">Protect your local records</span>
            <span className="block text-sm font-bold text-gray-900 dark:text-gray-100">{contextualBackup.message}</span>
          </span>
          <span className="shrink-0 text-xs font-black uppercase tracking-wider text-teal-700 dark:text-teal-300">Open</span>
        </button>
      ) : null}

      {pendingFinds && pendingFinds.length > 0 && (
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
            Open Queue
          </span>
        </button>
      )}

      {currentYearFindStats && (
        <section className="min-w-0 overflow-hidden">
          <button onClick={props.goFindsBox} className="flex items-baseline justify-between w-full mb-2 hover:opacity-70 transition-opacity border-0 bg-transparent p-0">
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

      {!isFirstRun && (
        <div
          className="group flex w-full min-w-0 max-w-full cursor-pointer items-center gap-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-md transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 sm:hover:scale-[1.008]"
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
            <div className="font-black text-gray-800 dark:text-gray-100 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">Field Guide</div>
            <div className="text-2xs text-gray-500/80 dark:text-gray-400/80 mt-0.5 leading-snug tracking-[0.01em]">Understand the landscape before you dig</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); props.goFieldGuide(); }}
            className="min-h-11 shrink-0 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all"
          >
            Open
          </button>
        </div>
      )}

      {!isFirstRun && !clubRallyCardDismissed && (
        <div
          className="group relative flex w-full min-w-0 max-w-full cursor-pointer items-center gap-4 rounded-2xl border border-teal-100 bg-white p-3 pr-10 shadow-sm transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-md dark:border-teal-900/60 dark:bg-gray-800 sm:hover:scale-[1.008]"
          onClick={() => setShowClubRallyModal(true)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void dismissClubRallyCard(); }}
            className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-gray-500 transition-colors hover:bg-gray-50 hover:text-red-500 dark:text-gray-400 dark:hover:bg-gray-900/60 dark:hover:text-red-400"
            aria-label="Hide club/rally shortcut"
          >
            ×
          </button>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-teal-200 bg-teal-50 text-teal-700 transition-colors group-hover:border-teal-300 group-hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300 dark:group-hover:border-teal-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8.5 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M15.5 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M3.5 18.5c.8-2.8 2.5-4.2 5-4.2s4.2 1.4 5 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M13.5 15c2.6.2 4.2 1.4 4.9 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-black text-gray-800 dark:text-gray-100 text-sm group-hover:text-teal-600 dark:group-hover:text-teal-300 transition-colors">Run a club dig or rally</div>
            <div className="text-2xs text-gray-500/80 dark:text-gray-400/80 mt-0.5 leading-snug tracking-[0.01em]">Set up a club day pack, join with a link, or log rally finds.</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowClubRallyModal(true); }}
            className="min-h-11 shrink-0 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 rounded-lg hover:bg-teal-600 hover:text-white hover:border-teal-600 transition-all"
          >
            Open
          </button>
        </div>
      )}

      <section className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
            <div className="flex items-baseline gap-4">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">Permissions</h2>
                {!isFirstRun && <button onClick={props.goPermissions} className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-2xs font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all">Open All</button>}
            </div>
            {!isFirstRun && <div className="flex items-center gap-3 w-full md:max-w-md">
                <div className="relative flex-1">
                    <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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

            </div>}
        </div>
        
        {(!filteredPermissions || filteredPermissions.length === 0) && (
            <div className={`rounded-2xl border border-dashed text-center animate-in zoom-in-95 duration-500 ${
              isFirstRun
                ? "bg-gray-50 p-4 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700"
                : "bg-emerald-50 p-8 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
            }`}>
                {searchQuery ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">No results found matching your search.</p>
                ) : (
                    <div className="flex flex-col items-center gap-2">
                        <p className={`text-sm font-bold ${isFirstRun ? "text-gray-700 dark:text-gray-200" : "text-emerald-800 dark:text-emerald-300"}`}>No saved permissions yet.</p>
                        <p className={`text-sm max-w-md ${isFirstRun ? "text-gray-500 dark:text-gray-400" : "text-emerald-700/70 dark:text-emerald-400/80"}`}>
                          {isFirstRun ? "Add one when you are ready to keep landowner, field and session records together." : "Add a permission if you already have access to the land."}
                        </p>
                        <button onClick={props.goPermission} className={`${isFirstRun ? "mt-1 px-4 py-2 text-xs" : "min-h-11 px-6 py-3 text-sm"} bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-black uppercase tracking-widest shadow-sm active:translate-y-1 transition-all`}>
                            Add Permission
                        </button>
                        <button onClick={() => nav('/land-access')} className="px-4 py-2 text-xs font-black uppercase tracking-widest text-emerald-700 hover:underline dark:text-emerald-300">
                            Need help asking? Open the land access guide
                        </button>
                    </div>
                )}
            </div>
        )}
        
        {filteredPermissions && filteredPermissions.length > 0 && (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPermissions.map((permission) => (
              <PermissionCard
                key={permission.id}
                permission={permission}
                onOpen={() => props.goPermissionEdit(permission.id)}
                onAddFind={() => props.goFind(permission.id)}
                onOpenFieldGuide={permission.lat != null && permission.lon != null
                  ? () => nav(`/fieldguide?lat=${permission.lat}&lng=${permission.lon}`)
                  : undefined}
                onTogglePin={() => setPermissionPinned(permission.id, !permission.isPinned).catch(console.error)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Latest Finds</h2>
            {(!isFirstRun || (recentFinds?.length ?? 0) > 0) && <button onClick={props.goAllFinds} className="shrink-0 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-2.5 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-2xs font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all">
              <span className="sm:hidden">Finds</span>
              <span className="hidden sm:inline">Open All Finds</span>
            </button>}
        </div>

        {(!recentFinds || recentFinds.length === 0) && (
          <div className={`${isFirstRun ? "p-4" : "p-8"} bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 text-center`}>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">No finds recorded yet.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">When you record your first find, it will appear here.</p>
            {!isFirstRun && <button onClick={() => props.goFind()} className="mt-4 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-emerald-500">Record First Find</button>}
          </div>
        )}
        
        {recentFinds && recentFinds.length > 0 && (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentFinds.slice(0, 3).map((s) => {
              const media = firstMediaMap?.get(s.id);
              if (!media) {
                return (
                  <div
                    key={s.id}
                    className="min-h-24 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-md dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
                    onClick={() => setOpenFindId(s.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="inline-flex rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-tighter text-white dark:bg-black">{s.findCode}</strong>
                        <div className="mt-3 truncate text-base font-black leading-tight text-gray-800 transition-colors group-hover:text-emerald-600 dark:text-gray-100" title={s.objectType}>{s.objectType || "(Object TBD)"}</div>
                      </div>
                      <div className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-400 dark:border-gray-700 dark:text-gray-500">
                        No photo
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="rounded border border-gray-200 bg-gray-50 px-1 font-bold uppercase dark:border-gray-700 dark:bg-gray-900">{s.period}</span>
                        {s.material !== "Other" && <span className="truncate capitalize">{s.material}</span>}
                      </div>
                      <span className="shrink-0 opacity-70">{new Date(s.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-md hover:shadow-lg hover:-translate-y-[1px] transition-all duration-200 ease-out flex flex-col h-full group cursor-pointer" onClick={() => setOpenFindId(s.id)}>
                  <div className="aspect-square bg-gray-100 dark:bg-gray-900 relative">
                    <ScaledImage
                      media={media}
                      className="w-full h-full"
                      imgClassName="object-cover"
                    />
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
        <React.Suspense fallback={null}>
          <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />
        </React.Suspense>
      )}

      {showInstallGuide && (
        <Modal title="Install FindSpot" onClose={closeInstallGuide}>
          <div className="grid gap-4">
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              Add FindSpot to your home screen so it opens like an app and keeps more screen space for maps, finds and field notes.
            </p>

            <div className="grid gap-2">
              {(installPlatform === 'ios' ? [
                'Open findspot.uk in Safari.',
                'Tap the Share button.',
                'Choose Add to Home Screen, then tap Add.',
              ] : installPlatform === 'android' ? [
                'Open findspot.uk in Chrome.',
                'Tap the three-dot menu.',
                'Choose Install app or Add to Home screen, then confirm.',
              ] : [
                'Open findspot.uk in your browser.',
                'Use the install icon in the address bar, or the browser menu.',
                'Choose Install or Add to desktop, then confirm.',
              ]).map((step, index) => (
                <div key={step} className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{step}</span>
                </div>
              ))}
            </div>

            <button
              onClick={closeInstallGuide}
              className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500"
            >
              Got It
            </button>
          </div>
        </Modal>
      )}

      {showClubRallyModal && (
        <ClubRallyChoiceModal
          onClose={() => setShowClubRallyModal(false)}
          onSolo={() => { setShowClubRallyModal(false); nav("/permission?type=rally&personalRecord=true"); }}
          onJoinUrl={(url) => { setShowClubRallyModal(false); nav(url); }}
          onOrganiseNew={() => { setShowClubRallyModal(false); nav("/permission?type=rally&organiserSetup=true"); }}
          onOrganiseExisting={(id) => { setShowClubRallyModal(false); nav(`/permission/${id}?openClubDay=true`); }}
          permissions={(permissions || [])
            .filter(p => !p.isClubDayMember && !p.isDefault)
            .map(p => ({ id: p.id, name: p.name, type: p.type }))}
        />
      )}
      {confirmDialog}
    </div>
  );
}
