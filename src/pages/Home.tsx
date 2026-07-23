import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, Media } from "../db";
import { getSetting } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";
import { enrichPermissions } from "../services/permissions";
import { PermissionCard } from "../components/PermissionCard";
import { deriveTreasureClock, TreasureClockItem } from "../services/treasureClock";
import { ClubRallyChoiceModal } from "../components/ClubRallyChoiceModal";
import { Modal } from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmModal";
import { getPackMeta, isPackStale } from "../services/offlinePack";
import { UndugSignalSheet } from "../components/UndugSignalSheet";
import { LockIcon, SearchIcon } from "../components/AppIcons";
import { ephemeralSession, useDurableSetting } from '../services/clientStorage';
import { getBackupReminderState } from '../services/backupReminder';
import { setPermissionPinned } from '../services/permissionMutations';
import { reportNonFatal } from '../services/diagLog';

const FindModal = React.lazy(() =>
  import("../components/FindModal").then((mod) => ({ default: mod.FindModal }))
);

function SignalMarkerIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.25c-2.42 0-4.4 1.9-4.4 4.25 0 3.15 3.35 6.35 4.05 6.98.2.18.5.18.7 0 .7-.63 4.05-3.83 4.05-6.98 0-2.35-1.98-4.25-4.4-4.25Z" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="6.6" r="1.35" fill="currentColor" />
      <path d="M5.1 14.5c1.22.78 2.9 1.25 4.9 1.25s3.68-.47 4.9-1.25M7.65 12.85c.68.26 1.48.4 2.35.4s1.67-.14 2.35-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const CLUB_RALLY_HOME_CARD_DISMISSED_KEY = "fs_club_rally_home_card_dismissed";

type FieldGuidePackPrompt =
  | { kind: "permission"; id: string; name: string; stale: boolean }
  | { kind: "savedPoint"; id: string; name: string; stale: boolean }
  | null;

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
  const [usedActions, setUsedActions] = useState<Set<string>>(() => {
    try {
      const stored = ephemeralSession.get('fs_used_actions');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [showHomeSignalSheet, setShowHomeSignalSheet] = useState(false);
  const [homeSignalToast, setHomeSignalToast] = useState<{ openCount: number } | null>(null);
  const homeSignalToastTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => { if (homeSignalToastTimerRef.current !== null) window.clearTimeout(homeSignalToastTimerRef.current); };
  }, []);
  const [dismissedNextMoves, setDismissedNextMoves] = useDurableSetting<Record<string, number>>('fs_nextmove_dismissed', {});

  const dismissNextMove = useCallback((key: string) => {
    setDismissedNextMoves(prev => ({ ...prev, [key]: Date.now() }));
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
      message: "This will remove the Run a club dig or rally shortcut from your Home screen permanently on this device.\n\nYou can still open the feature from the Club/Rally button at the top, next to Settings.",
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

  const isDismissed = useCallback((key: string, type: string): boolean => {
    if (type === 'active_session' || type === 'treasure_clock') return false;
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
    async () => db.finds.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const pendingFinds = useMemo(() => finds?.filter(f => f.isPending), [finds]);
  const recentFinds = useMemo(() => finds?.filter(f => !f.isPending && !f.scatterId && !f.isNotableFind), [finds]);
  const completedFindCount = recentFinds?.length ?? 0;
  const isFirstRun = !!permissions && realPermissions.length === 0 && completedFindCount === 0;
  const [fieldGuideScanCount] = useDurableSetting('fs_fg_scan_count', 0);

  const appSettings = useLiveQuery(async () => {
    const detectorist = await db.settings.get('detectorist');
    return {
      detectorist: (detectorist?.value as string) || '',
    };
  });
  const backupReminder = useLiveQuery(() => getBackupReminderState());

  const fieldGuidePackPrompt = useLiveQuery<FieldGuidePackPrompt>(async () => {
    const [permissionRows, savedPointRows] = await Promise.all([
      db.permissions.where("projectId").equals(props.projectId).toArray(),
      db.savedPoints.where("projectId").equals(props.projectId).toArray(),
    ]);

    const mappedPermissions = permissionRows
      .filter(p => !p.isDefault && !p.isClubDayMember && !!p.boundary)
      .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));

    for (const permission of mappedPermissions.slice(0, 8)) {
      const meta = await getPackMeta({ ownerType: "permission", ownerId: permission.id }).catch(() => null);
      if (!meta || isPackStale(meta)) {
        return { kind: "permission", id: permission.id, name: permission.name || "Unnamed permission", stale: !!meta };
      }
    }

    const savedPoints = savedPointRows
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const point of savedPoints.slice(0, 8)) {
      const meta = await getPackMeta({ ownerType: "savedPoint", ownerId: point.id }).catch(() => null);
      if (!meta || isPackStale(meta)) {
        return { kind: "savedPoint", id: point.id, name: point.label || "Saved point", stale: !!meta };
      }
    }

    return null;
  }, [props.projectId, realPermissions.length]);

  const nextMoveItems = useMemo(() => {
    const items: Array<{
      type: string;
      dismissKey: string;
      message: string;
      detail?: string;
      cta: string;
      action: () => void;
    }> = [];

    // ── Treasure clock — statutory reporting window (non-dismissable) ────
    if (treasureClock && treasureClock.length > 0) {
      const most = treasureClock[0]; // most urgent (sorted daysElapsed desc)
      const isScotland = most.jurisdiction === "scotland";
      const tierDetail = isScotland
        ? "Report to the Treasure Trove Unit \u2014 significant finds in Scotland must be reported."
        : most.tier === "overdue"
          ? "If you haven\u2019t reported yet, contact your FLO now \u2014 report late rather than not at all."
          : most.tier === "red"
            ? "The 14-day reporting window is closing. Contact your FLO as soon as possible."
            : most.tier === "amber"
              ? "Treasure finds must be reported within 14 days of realising they may be Treasure."
              : "Treasure finds must be reported within 14 days of realising they may be Treasure.";
      const rider = treasureClock.length > 1
        ? ` +${treasureClock.length - 1} more awaiting report`
        : "";
      items.push({
        type: "treasure_clock",
        dismissKey: `treasure_clock:${most.sfId}`,
        message: isScotland
          ? `${most.permissionName}: significant find recorded`
          : `${most.permissionName}: significant find recorded ${most.daysElapsed} days ago`,
        detail: tierDetail + rider,
        cta: "Review Find",
        action: () => nav(`/finds-box?tab=significant&sf=${most.sfId}`),
      });
    }

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
    const hasNoSavedFieldwork = !!permissions && !!finds && realPermissions.length === 0 && completedFindCount === 0 && (pendingFinds?.length ?? 0) === 0;
    if (hasNoSavedFieldwork && fieldGuideScanCount === 0) {
      items.push({
        type: 'first_fieldguide_scan',
        dismissKey: 'first_fieldguide_scan',
        message: 'Read a field before setting anything up',
        detail: 'Run a FieldGuide scan to compare terrain, movement, landscape and historic context.',
        cta: 'Scan Land',
        action: props.goFieldGuide,
      });
    } else if (hasNoSavedFieldwork && fieldGuideScanCount > 0) {
      items.push({
        type: 'post_fieldguide_scan',
        dismissKey: 'post_fieldguide_scan',
        message: 'Save the land you want to work',
        detail: 'Create a simple permission now; boundaries and landowner details can come later.',
        cta: 'Create Permission',
        action: props.goPermission,
      });
    }
    if (!props.isStandalone && !installNextStepDismissed) {
      items.push({
        type: 'install_app',
        dismissKey: 'install_app',
        message: 'Install FindSpot on this device',
        detail: 'Use it from your home screen without the browser bar.',
        cta: 'Install App',
        action: () => {
          props.promptInstall().then(prompted => {
            if (prompted) {
              dismissInstallNextStep();
              return;
            }
            setShowInstallGuide(true);
          });
        },
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
    if (fieldGuidePackPrompt) {
      items.push({
        type: `fieldguide_pack_${fieldGuidePackPrompt.kind}`,
        dismissKey: `fieldguide_pack:${fieldGuidePackPrompt.kind}:${fieldGuidePackPrompt.id}:${fieldGuidePackPrompt.stale ? 'stale' : 'missing'}`,
        message: fieldGuidePackPrompt.stale
          ? 'Refresh your offline FieldGuide data'
          : 'Download FieldGuide data for offline use',
        detail: fieldGuidePackPrompt.kind === 'permission'
          ? `${fieldGuidePackPrompt.name}: terrain, heritage layers and PAS density for use before you lose signal.`
          : `${fieldGuidePackPrompt.name}: save the nearby FieldGuide layers for a return visit.`,
        cta: fieldGuidePackPrompt.kind === 'permission' ? 'Prepare Data' : 'Open Points',
        action: fieldGuidePackPrompt.kind === 'permission'
          ? () => props.goPermissionEdit(fieldGuidePackPrompt.id)
          : () => nav('/fieldguide?savedPoints=1'),
      });
    }
    if (permissions && permissions.length > 0) {
      const real = permissions.filter(p => !p.isDefault);
      const now = Date.now();
      const upcomingRallies = real
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
      const stalePerms = real.filter(p => {
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
      const newPerms = real.filter(p => p.type !== "rally" && p.sessionCount === 0);
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
  }, [pendingFinds, activeSession, permissions, realPermissions, completedFindCount, finds, fieldGuideScanCount, nav, props, installNextStepDismissed, fieldGuidePackPrompt, treasureClock]);

  const nextMove = nextMoveItems.find(item => !isDismissed(item.dismissKey, item.type)) ?? null;

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
    // Add, rotate, or remove entries here to adapt to user behaviour.
    // The first 4 non-null entries are available on mobile; larger screens show the first 2.
    const pool: Action[] = isNewUser ? [
      { label: 'Create Permission',    mobileLabel: 'Permission', action: props.goPermission },
      { label: 'Scan with FieldGuide', mobileLabel: 'FieldGuide',  action: props.goFieldGuide },
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
      { label: 'Scan with FieldGuide', mobileLabel: 'FieldGuide',  action: props.goFieldGuide },
    ] : [
      { label: 'Record Find',          action: () => props.goFind() },
      { label: 'Scan with FieldGuide', mobileLabel: 'FieldGuide',  action: props.goFieldGuide },
      { label: 'Create Permission',    mobileLabel: 'Permission',  action: props.goPermission },
    ];
    // ────────────────────────────────────────────────────────────────────────

    const availableActions = pool.filter(Boolean) as NonNullable<Action>[];
    const unusedActions = availableActions.filter(a => !usedActions.has(a.label));
    const visibleActions = unusedActions.length > 0 ? unusedActions : availableActions;

    return visibleActions
      .slice(0, 4)
      .map(a => ({
        ...a,
        action: () => {
          try {
            const stored = ephemeralSession.get('fs_used_actions');
            const current: string[] = stored ? JSON.parse(stored) : [];
            ephemeralSession.set('fs_used_actions', JSON.stringify([...new Set([...current, a.label])]));
          } catch (error) {
            reportNonFatal('home', 'Quick action history save failed', error);
          }
          setUsedActions(prev => new Set(prev).add(a.label));
          a.action();
        },
      }));
  }, [permissions, realPermissions, finds, appSettings, backupReminder, usedActions, nav, props]);

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
    <div className="grid gap-5 max-w-5xl mx-auto overflow-hidden px-4 pb-20 mt-4">
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
      <button
        onClick={() => setPrivacyExpanded(v => !v)}
        className="flex items-center justify-center gap-2 py-1 px-1 w-full text-left opacity-40 hover:opacity-60 transition-opacity"
      >
        <LockIcon className="h-3.5 w-3.5 shrink-0" />
        {privacyExpanded ? (
          <p className="text-xs font-normal text-black dark:text-white m-0">
            Your saved finds, GPS coordinates, photos and landowner details stay on this device unless you export or share them. Online features may request map tiles, search results or landscape data for the area you are viewing; Discover only sends details you type into its submit forms.
          </p>
        ) : (
          <span className="text-xs font-normal text-black dark:text-white">Local-first storage · No subscriptions · No accounts</span>
        )}
      </button>

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
              { label: "Scan land", detail: "Read the area first.", action: props.goFieldGuide, active: true },
              { label: "Save permission", detail: "Add land details.", action: props.goPermission, active: false },
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
      ) : nextMove ? (
        <div className={`relative rounded-2xl p-4 pr-7 flex items-center justify-between gap-4 ${
          nextMove.type === 'treasure_clock'
            ? (treasureClock?.[0]?.tier === 'red' || treasureClock?.[0]?.tier === 'overdue'
                ? 'bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800'
                : treasureClock?.[0]?.tier === 'amber'
                  ? 'bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800'
                  : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700')
            : nextMove.type === 'upcoming_rally'
              ? 'bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800'
              : 'bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700'
        }`}>
          {nextMove.type !== 'active_session' && nextMove.type !== 'treasure_clock' && (
            <button
              onClick={() => {
                if (nextMove.type === 'install_app') {
                  dismissInstallNextStep();
                  return;
                }
                dismissNextMove(nextMove.dismissKey);
              }}
              className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center leading-none text-red-500 hover:text-red-600 transition-colors text-base outline-none border-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black mb-1 ${
              nextMove.type === 'active_session'
                ? 'uppercase tracking-widest text-amber-600 dark:text-amber-400'
                : nextMove.type === 'treasure_clock'
                  ? 'uppercase tracking-widest ' + (
                      treasureClock?.[0]?.tier === 'red' || treasureClock?.[0]?.tier === 'overdue'
                        ? 'text-red-600 dark:text-red-400'
                        : treasureClock?.[0]?.tier === 'amber'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-gray-600 dark:text-gray-400')
                  : 'uppercase tracking-widest ' + (nextMove.type === 'upcoming_rally' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')
            }`}>
              {nextMove.type === 'active_session' ? 'Session in progress' : nextMove.type === 'treasure_clock' ? 'Reporting obligation' : nextMove.type === 'upcoming_rally' ? 'Upcoming Rally' : 'Your next move'}
            </p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-snug">{nextMove.message}</p>
            {'detail' in nextMove && nextMove.detail && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{nextMove.detail}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col sm:flex-row gap-2">
            {nextMove.type === 'active_session' && activeSession && (
              <>
                <button
                  onClick={() => setShowHomeSignalSheet(true)}
                  className="min-h-11 text-emerald-700 dark:text-emerald-300 text-xs font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5 shadow-sm"
                  title="Log a signal you chose not to dig"
                >
                  <SignalMarkerIcon className="w-3.5 h-3.5 shrink-0" />
                  Log Signal
                </button>
                <button
                  onClick={() => nav(`/find?permissionId=${activeSession.permissionId}&sessionId=${activeSession.id}&mode=quick${activeSession.fieldId ? `&fieldId=${activeSession.fieldId}` : ''}`)}
                  className="min-h-11 text-white text-xs font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all whitespace-nowrap bg-amber-500 hover:bg-amber-400 shadow-sm shadow-amber-500/20"
                >
                  Quick Find
                </button>
              </>
            )}
            <button
              onClick={nextMove.action}
              className={`min-h-11 text-white text-xs font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all whitespace-nowrap ${
                nextMove.type === 'treasure_clock'
                  ? (treasureClock?.[0]?.tier === 'red' || treasureClock?.[0]?.tier === 'overdue'
                      ? 'bg-red-600 hover:bg-red-500 shadow-sm shadow-red-600/20'
                      : treasureClock?.[0]?.tier === 'amber'
                        ? 'bg-amber-500 hover:bg-amber-400 shadow-sm shadow-amber-500/20'
                        : 'bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-600/20')
                  : nextMove.type === 'upcoming_rally'
                    ? 'bg-amber-500 hover:bg-amber-400 shadow-sm shadow-amber-500/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-sm shadow-emerald-600/20'
              }`}
            >
              {nextMove.cta}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-4 flex items-center gap-3 overflow-hidden bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {adaptiveActions.map((item, index) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`${index >= 2 ? 'min-[400px]:hidden' : ''} min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide text-gray-700 transition-all active:scale-[0.98] dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-200 hover:border-emerald-400 dark:hover:border-emerald-500 sm:shrink-0 sm:rounded-full sm:px-4 sm:py-2.5 sm:text-sm sm:font-medium sm:normal-case sm:tracking-normal`}
              >
                <span className="sm:hidden">{item.mobileLabel ?? item.label}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
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
          className="relative flex items-center gap-4 p-3 pr-10 bg-white dark:bg-gray-800 border border-teal-100 dark:border-teal-900/60 rounded-2xl shadow-sm hover:shadow-md hover:scale-[1.008] hover:-translate-y-px transition-all duration-200 ease-out cursor-pointer group"
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
                        <button onClick={props.goPermission} className={`${isFirstRun ? "mt-1 px-4 py-2 text-xs" : "min-h-11 px-6 py-3 text-sm"} bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest shadow-sm active:translate-y-1 transition-all`}>
                            Add Permission
                        </button>
                    </div>
                )}
            </div>
        )}
        
        {filteredPermissions && filteredPermissions.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          onSolo={() => { setShowClubRallyModal(false); props.goPermissionWithParam("rally"); }}
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
