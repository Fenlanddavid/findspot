import React, { useEffect, useState, useMemo, useCallback } from "react";
import { usePermissionForm } from "../hooks/usePermissionForm";
import { db, Permission, Find, Media, GeoJSONPolygon } from "../db";
import { v4 as uuid } from "uuid";
import { captureGPS } from "../services/gps";
import { loadRallyDayReview } from "../services/rallyDayReview";
import { CreateClubDayPackModal, ExportClubDayModal, ImportClubDayDataModal } from "../components/ClubDayModals";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FindRow } from "../components/FindRow";
import { FindModal } from "../components/FindModal";
import { ScaledImage } from "../components/ScaledImage";
import { StaticMapPreview } from "../components/StaticMapPreview";
import { RallyDayReviewPanel } from "../components/RallyDayReviewPanel";
import PermissionReportModal from "../components/PermissionReportModal";
import { AgreementModal } from "../components/AgreementModal";
import { LocationPickerModal } from "../components/LocationPickerModal";
import { BoundaryPickerModal } from "../components/BoundaryPickerModal";
import { FieldModal } from "../components/FieldModal";
import { FieldNotesModal } from "../components/FieldNotesModal";
import PermissionProofModal from "../components/PermissionProofModal";
import { PermissionActivityColumn } from "../components/PermissionActivityColumn";
import { PermissionFieldsColumn } from "../components/PermissionFieldsColumn";
import { OutstandingQuestionsCard } from "../components/OutstandingQuestionsCard";
import { RallyPersonaChip } from "../components/RallyPersonaChip";
import { rallyPersona } from "../utils/rallyPersona";
import { useConfirmDialog } from "../components/ConfirmModal";
import { CoachTip, CoachTips } from "../components/CoachTips";
import {
    buildPack, deletePack, getPackMeta, isPackStale,
    estimatePack, PackMeta, BuildProgress,
} from "../services/offlinePack";
import { deleteQuestionsWithNotes } from "../outstandingQuestions/questionNotes";

const PERMISSION_HELPERS_SEEN_KEY = "fs_permission_helpers_seen";

function formatMB(bytes: number): string {
    if (bytes < 1_000_000) return `${Math.max(1, Math.ceil(bytes / 1_000))} KB`;
    if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    return `${Math.round(bytes / 1_000_000)} MB`;
}

type PermPackStatus =
    | { kind: 'checking' }
    | { kind: 'none'; estMB: string }
    | { kind: 'building'; pct: number }
    | { kind: 'done'; meta: PackMeta; stale: boolean }
    | { kind: 'error' };

function getBoundaryCenter(boundary?: GeoJSONPolygon | null): { lat: number; lon: number } | null {
  const ring = boundary?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;

  const points = ring.filter((p: unknown): p is [number, number] =>
    Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
  );
  if (points.length === 0) return null;

  const lons = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  return {
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
}

function formatDeleteCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function PermissionPage(props: {
  projectId: string;
  onSaved: (id: string) => void;
}) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirmDialog();
  const isEdit = !!id;

  const organiserSetupParam = searchParams.get("organiserSetup") === "true";
  const openClubDayParam = searchParams.get("openClubDay") === "true";

  const [error, setError] = useState<string | null>(null);
  const {
    name, setName, type, setType, collector, setCollector,
    lat, setLat, lon, setLon, acc, setAcc,
    landownerName, setLandownerName, landownerPhone, setLandownerPhone,
    landownerEmail, setLandownerEmail, landownerAddress, setLandownerAddress,
    landType, setLandType, permissionGranted, setPermissionGranted, validFrom, setValidFrom,
    insuranceProvider, setInsuranceProvider, ncmdNumber, setNcmdNumber, ncmdExpiry, setNcmdExpiry,
    detectoristName, setDetectoristName, detectoristEmail, setDetectoristEmail,
    notes, setNotes, boundary, setBoundary, agreementId, setAgreementId,
    isClubDayMember, setIsClubDayMember, isPersonalRallyRecord, setIsPersonalRallyRecord,
    isSharedPermission, setIsSharedPermission, sharedPermissionId, setSharedPermissionId,
    organiserContactNumber, setOrganiserContactNumber, organiserEmail, setOrganiserEmail,
    submittedAt, setSubmittedAt, significantFindInstructions, setSignificantFindInstructions,
    clubDayPublicNotes, setClubDayPublicNotes, loading,
  } = usePermissionForm(id, searchParams, setError);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(!isEdit);
  const [showNewPermissionDetails, setShowNewPermissionDetails] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [isPickingBoundary, setIsPickingBoundary] = useState(false);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);
  const [proofModalOpen, setProofModalOpen] = useState(false);

  const [openFindId, setOpenFindId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [notesFieldId, setNotesFieldId] = useState<string | null>(null);
  const [isAddingField, setIsAddingField] = useState(false);
  const [showAttendeeFields, setShowAttendeeFields] = useState(false);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  // null = closed; undefined = whole permission; string = specific fieldId
  const [reportTarget, setReportTarget] = useState<string | undefined | null>(null);

  // Club Day UI state
  const [showCreatePack, setShowCreatePack] = useState(false);
  const [showExportClubDay, setShowExportClubDay] = useState(false);
  const [showImportClubDayData, setShowImportClubDayData] = useState(false);
  const [permissionCoachActive, setPermissionCoachActive] = useState(false);
  const [permissionCoachStep, setPermissionCoachStep] = useState(0);

  // Offline pack state for this permission
  const [permPackStatus, setPermPackStatus] = useState<PermPackStatus>({ kind: 'checking' });
  const [pendingEvictPerm, setPendingEvictPerm] = useState(false);
  const boundaryPackKey = useMemo(() => boundary ? JSON.stringify(boundary.coordinates) : '', [boundary]);

  const fields = useLiveQuery(async () => {
    if (!id) return [];
    return db.fields.where("permissionId").equals(id).reverse().sortBy("createdAt");
  }, [id]);

  const isFirstPermission = useLiveQuery(async () => {
    if (isEdit) return false;
    return (await db.permissions.where("projectId").equals(props.projectId).filter(p => !p.isDefault).count()) === 0;
  }, [isEdit, props.projectId]);

  const agreementFile = useLiveQuery(async () => {
    if (!agreementId) return null;
    return db.media.get(agreementId);
  }, [agreementId]);

  // Fetch finds for this trip
  const finds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !f.isPending && !f.scatterId && !f.isNotableFind).reverse().sortBy("createdAt");
  }, [id]);

  const pendingFinds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !!f.isPending).reverse().sortBy("createdAt");
  }, [id]);

  const standaloneFinds = useLiveQuery(async () => {
    if (!id) return [];
    return db.finds.where("permissionId").equals(id).filter(f => !f.isPending && !f.sessionId && !f.scatterId && !f.isNotableFind).reverse().sortBy("createdAt");
  }, [id]);

  const sessions = useLiveQuery(async () => {
    if (!id) return [];
    const rows = await db.sessions
      .where("permissionId")
      .equals(id)
      .toArray();

    // Sort by date (descending), then by createdAt (descending)
    rows.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      const bDate = b?.createdAt || "";
      const aDate = a?.createdAt || "";
      return bDate.localeCompare(aDate);
    });
    
    // Batch fetch all related data in 3 queries instead of 3×N
    const sessionIds = rows.map(s => s.id);
    const fieldIds = [...new Set(rows.map(s => s.fieldId).filter(Boolean) as string[])];

    const [allFindsForSessions, allTracksForSessions, allFields] = await Promise.all([
      db.finds.where("sessionId").anyOf(sessionIds).toArray(),
      db.tracks.where("sessionId").anyOf(sessionIds).toArray(),
      fieldIds.length > 0 ? db.fields.bulkGet(fieldIds) : Promise.resolve([]),
    ]);

    const findCountBySession = new Map<string, number>();
    for (const f of allFindsForSessions) {
      if (f.sessionId) findCountBySession.set(f.sessionId, (findCountBySession.get(f.sessionId) ?? 0) + 1);
    }

    const tracksBySession = new Map<string, typeof allTracksForSessions>();
    for (const t of allTracksForSessions) {
      if (!t.sessionId) continue;
      if (!tracksBySession.has(t.sessionId)) tracksBySession.set(t.sessionId, []);
      tracksBySession.get(t.sessionId)!.push(t);
    }

    const fieldById = new Map(allFields.filter(Boolean).map(f => [f!.id, f!]));

    return rows.map(s => {
      const field = s.fieldId ? fieldById.get(s.fieldId) ?? null : null;
      const findCount = findCountBySession.get(s.id) ?? 0;
      const sessionTracks = tracksBySession.get(s.id) ?? [];

      let durationMs = 0;
      if (sessionTracks.length > 0) {
        const allPoints = sessionTracks
          .flatMap(t => t.points || [])
          .filter(p => !!p && typeof p.timestamp === 'number')
          .sort((a, b) => a.timestamp - b.timestamp);

        if (allPoints.length > 1) {
          durationMs = allPoints[allPoints.length - 1].timestamp - allPoints[0].timestamp;
        }
      }

      return { ...s, fieldName: field?.name, findCount, hasTracking: sessionTracks.length > 0, durationMs };
    });
  }, [id]);


  // Submitted members (organiser side of club day)
  const submittedMembers = useLiveQuery(async () => {
    if (!id) return [];
    const perm = await db.permissions.get(id);
    if (!perm?.isSharedPermission || !perm.sharedPermissionId) return [];
    return db.importedPackages.where("sharedPermissionId").equals(perm.sharedPermissionId).sortBy("importedAt");
  }, [id]);

  const rallyDayReview = useLiveQuery(async () => {
    if (!id) return null;
    const perm = await db.permissions.get(id);
    if (!perm?.isSharedPermission || perm.isClubDayMember) return null;
    return loadRallyDayReview(id);
  }, [id]);

  // Fetch all media for the report
  const allMedia = useLiveQuery(async () => {
    if (!id || !finds || finds.length === 0) return [];
    const ids = finds.map(s => s.id).filter(Boolean);
    if (ids.length === 0) return [];
    return db.media.where("findId").anyOf(ids).toArray();
  }, [id, finds]);

  // Fetch thumbnails and scale info for the finds
  const findThumbMedia = useMemo(() => {
    const info = new Map<string, Media>();
    if (!allMedia || !finds) return info;
    
    const sortedMedia = [...allMedia].sort((a, b) => {
        const aDate = a?.createdAt || "";
        const bDate = b?.createdAt || "";
        return aDate.localeCompare(bDate);
    });
    for (const row of sortedMedia) {
      if (row.findId && !info.has(row.findId)) {
        info.set(row.findId, row);
      }
    }
    return info;
  }, [allMedia, finds]);

  const fieldFindCounts = useMemo(() => {
    const counts = new Map<string, { recorded: number; pending: number }>();
    const ensure = (fieldId: string) => {
      const existing = counts.get(fieldId);
      if (existing) return existing;
      const next = { recorded: 0, pending: 0 };
      counts.set(fieldId, next);
      return next;
    };

    for (const find of finds ?? []) {
      if (find.fieldId) ensure(find.fieldId).recorded += 1;
    }
    for (const find of pendingFinds ?? []) {
      if (find.fieldId) ensure(find.fieldId).pending += 1;
    }
    return counts;
  }, [finds, pendingFinds]);

  const allTracks = useLiveQuery(async () => {
    if (!id) return [];
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id).filter(Boolean);
    if (sessionIds.length === 0) return [];
    return db.tracks.where("sessionId").anyOf(sessionIds).toArray();
  }, [id]);


  useEffect(() => {
    if (isEdit) {
      const msg = sessionStorage.getItem('fs_pending_toast');
      if (msg) {
        sessionStorage.removeItem('fs_pending_toast');
        setMilestoneMsg(msg);
        setTimeout(() => setMilestoneMsg(null), 4000);
      }
    }
  }, [isEdit]);

  // Auto-open club day pack modal when navigating from global organiser flow
  useEffect(() => {
    if (!loading && isEdit && openClubDayParam) {
      setShowCreatePack(true);
    }
  }, [loading, isEdit, openClubDayParam]);

  // Load offline pack status when permission has a boundary
  useEffect(() => {
    if (!isEdit || !id || !boundary) return;
    setPermPackStatus({ kind: 'checking' });
    Promise.all([
        getPackMeta({ ownerType: 'permission', ownerId: id }),
        estimatePack({ ownerType: 'permission', ownerId: id }),
    ]).then(([meta, est]) => {
        if (meta) {
            setPermPackStatus({ kind: 'done', meta, stale: isPackStale(meta) });
        } else {
            setPermPackStatus({ kind: 'none', estMB: formatMB(est.estBytes) });
        }
    }).catch(() => {
        setPermPackStatus({ kind: 'none', estMB: '~30 MB' });
    });
  }, [isEdit, id, boundaryPackKey, !!boundary]);

  async function doGPS() {
    setError(null);
    try {
      const fix = await captureGPS();
      setLat(fix.lat);
      setLon(fix.lon);
      setAcc(fix.accuracyM);
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    }
  }

  const handlePackPrepare = useCallback(async () => {
    if (!id) return;
    setPermPackStatus({ kind: 'building', pct: 0 });
    try {
        await buildPack(
            { ownerType: 'permission', ownerId: id },
            (p: BuildProgress) => {
                const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                setPermPackStatus({ kind: 'building', pct });
            },
            true,
        );
        const meta = await getPackMeta({ ownerType: 'permission', ownerId: id });
        if (meta) setPermPackStatus({ kind: 'done', meta, stale: false });
    } catch {
        setPermPackStatus({ kind: 'error' });
    }
  }, [id]);

  const handlePackEvict = useCallback(async () => {
    if (!id) return;
    await deletePack({ ownerType: 'permission', ownerId: id });
    const est = await estimatePack({ ownerType: 'permission', ownerId: id }).catch(() => ({ estBytes: 30_000_000 }));
    setPermPackStatus({ kind: 'none', estMB: formatMB(est.estBytes) });
    setPendingEvictPerm(false);
  }, [id]);

  async function handleDelete() {
    if (!id) return;
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id);
    const finds = await db.finds.where("permissionId").equals(id).toArray();
    const findIds = finds.map(f => f.id);
    const significantFinds = await db.significantFinds.where("permissionId").equals(id).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const fieldsToDelete = await db.fields.where("permissionId").equals(id).toArray();
    const findMediaCount = findIds.length ? await db.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await db.media.where("findId").anyOf(significantFindIds).count() : 0;
    const permissionMediaCount = await db.media.where("permissionId").equals(id).count();
    const mediaCount = findMediaCount + significantFindMediaCount + permissionMediaCount;
    const trackCount = sessionIds.length ? await db.tracks.where("sessionId").anyOf(sessionIds).count() : 0;

    if (!(await confirmAction({
      title: "Delete Permission?",
      message: `Delete ${name.trim() || "this permission"}?\n\nThis will permanently delete:\n` +
      `- ${formatDeleteCount(sessions.length, "session")}\n` +
      `- ${formatDeleteCount(finds.length, "find")}\n` +
      `- ${formatDeleteCount(significantFinds.length, "significant find")}\n` +
      `- ${formatDeleteCount(fieldsToDelete.length, "field")}\n` +
      `- ${formatDeleteCount(mediaCount, "photo/document", "photos/documents")}\n` +
      `- ${formatDeleteCount(trackCount, "GPS track")}`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;

    setSaving(true);
    try {
      await deletePack({ ownerType: 'permission', ownerId: id }).catch(() => {});
      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.significantFinds, db.media, db.fields, db.tracks, db.outstandingQuestions, db.questionNotes], async () => {
        if (findIds.length) await db.media.where("findId").anyOf(findIds).delete();
        if (significantFindIds.length) await db.media.where("findId").anyOf(significantFindIds).delete();
        await db.media.where("permissionId").equals(id).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.significantFinds.where("permissionId").equals(id).delete();
        if (sessionIds.length) await db.tracks.where("sessionId").anyOf(sessionIds).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.fields.where("permissionId").equals(id).delete();
        // Deleting the permission is an explicit full cascade. User-note
        // preservation applies to generated-question migrations, not to a
        // user deleting the parent permission and all of its records.
        const questionIds = (await db.outstandingQuestions.where("permissionId").equals(id).toArray()).map(q => q.id);
        if (questionIds.length) {
          await deleteQuestionsWithNotes(questionIds, { preserveUserNotes: false });
        }
        await db.permissions.delete(id);
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function handleDeleteClubDayPermission() {
    if (!id) return;
    const perm = await db.permissions.get(id);
    const sessions = await db.sessions.where("permissionId").equals(id).toArray();
    const sessionIds = sessions.map(s => s.id);
    const finds = await db.finds.where("permissionId").equals(id).toArray();
    const findIds = finds.map(f => f.id);
    const significantFinds = await db.significantFinds.where("permissionId").equals(id).toArray();
    const significantFindIds = significantFinds.map(f => f.id);
    const fieldsToDelete = await db.fields.where("permissionId").equals(id).toArray();
    const findMediaCount = findIds.length ? await db.media.where("findId").anyOf(findIds).count() : 0;
    const significantFindMediaCount = significantFindIds.length ? await db.media.where("findId").anyOf(significantFindIds).count() : 0;
    const permissionMediaCount = await db.media.where("permissionId").equals(id).count();
    const mediaCount = findMediaCount + significantFindMediaCount + permissionMediaCount;
    const trackCount = sessionIds.length ? await db.tracks.where("sessionId").anyOf(sessionIds).count() : 0;

    if (!(await confirmAction({
      title: "Remove Rally Permission?",
      message: `Remove ${name.trim() || "this club / rally permission"}?\n\nThis will permanently delete from this device:\n` +
      `- ${formatDeleteCount(sessions.length, "session")}\n` +
      `- ${formatDeleteCount(finds.length, "find")}\n` +
      `- ${formatDeleteCount(significantFinds.length, "significant find")}\n` +
      `- ${formatDeleteCount(fieldsToDelete.length, "field card")}\n` +
      `- ${formatDeleteCount(mediaCount, "photo/document", "photos/documents")}\n` +
      `- ${formatDeleteCount(trackCount, "GPS track")}\n\n` +
      "Use Keep Rally Record first if you want to keep them.",
      confirmLabel: "Remove",
      danger: true,
    }))) return;

    setSaving(true);
    try {
      await deletePack({ ownerType: 'permission', ownerId: id }).catch(() => {});
      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.significantFinds, db.media, db.fields, db.tracks, db.importedPackages, db.outstandingQuestions, db.questionNotes], async () => {
        if (findIds.length) await db.media.where("findId").anyOf(findIds).delete();
        if (significantFindIds.length) await db.media.where("findId").anyOf(significantFindIds).delete();
        await db.media.where("permissionId").equals(id).delete();
        await db.finds.where("permissionId").equals(id).delete();
        await db.significantFinds.where("permissionId").equals(id).delete();
        if (sessionIds.length) await db.tracks.where("sessionId").anyOf(sessionIds).delete();
        await db.sessions.where("permissionId").equals(id).delete();
        await db.fields.where("permissionId").equals(id).delete();
        // Full parent-record cascade; see the organiser path above.
        const questionIds = (await db.outstandingQuestions.where("permissionId").equals(id).toArray()).map(q => q.id);
        if (questionIds.length) {
          await deleteQuestionsWithNotes(questionIds, { preserveUserNotes: false });
        }
        await db.permissions.delete(id);
        // Remove the join record so the member can re-scan the QR if needed
        if (perm?.sharedPermissionId) {
          const joinRecord = await db.importedPackages
            .filter(p => p.sharedPermissionId === perm.sharedPermissionId)
            .first();
          if (joinRecord) await db.importedPackages.delete(joinRecord.id);
        }
      });
      nav("/");
    } catch (e: any) {
      setError("Delete failed: " + e.message);
      setSaving(false);
    }
  }

  async function handleKeepClubDayAsPersonalRecord() {
    if (!id) return;
    if (!(await confirmAction({
      title: "Keep Rally Record?",
      message: "Your finds, photos, fields, sessions, and tracks will stay on this device, but this record will no longer be linked to the organiser's QR export.",
      confirmLabel: "Keep Record",
    }))) return;

    setSaving(true);
    try {
      const perm = await db.permissions.get(id);
      const now = new Date().toISOString();
      const sharedId = perm?.sharedPermissionId;

      await db.transaction("rw", [db.permissions, db.sessions, db.finds, db.importedPackages], async () => {
        await db.permissions.update(id, {
          isClubDayMember: false,
          isPersonalRallyRecord: true,
          isSharedPermission: false,
          sharedPermissionId: undefined,
          organiserContactNumber: undefined,
          organiserEmail: undefined,
          significantFindInstructions: undefined,
          clubDayPublicNotes: undefined,
          submittedAt: undefined,
          landownerPhone: perm?.landownerPhone || perm?.organiserContactNumber,
          landownerEmail: perm?.landownerEmail || perm?.organiserEmail,
          notes: perm?.notes || perm?.clubDayPublicNotes || "",
          updatedAt: now,
        } as Partial<Permission>);

        await db.sessions.where("permissionId").equals(id).modify((session: any) => {
          delete session.sharedPermissionId;
          delete session.recorderId;
          delete session.recorderName;
          session.updatedAt = now;
        });

        await db.finds.where("permissionId").equals(id).modify((find: any) => {
          delete find.sharedPermissionId;
          delete find.recorderId;
          delete find.recorderName;
          find.updatedAt = now;
        });

        if (sharedId) {
          await db.importedPackages
            .filter(p => p.sharedPermissionId === sharedId)
            .delete();
        }
      });

      setIsClubDayMember(false);
      setIsPersonalRallyRecord(true);
      setIsSharedPermission(false);
      setSharedPermissionId(undefined);
      setOrganiserContactNumber(undefined);
      setOrganiserEmail(undefined);
      setSignificantFindInstructions(undefined);
      setClubDayPublicNotes(undefined);
      setSubmittedAt(undefined);
      setLandownerPhone(landownerPhone || perm?.organiserContactNumber || "");
      setLandownerEmail(landownerEmail || perm?.organiserEmail || "");
      setNotes(perm?.notes || perm?.clubDayPublicNotes || "");
      setMilestoneMsg("Saved as your own dig record");
      setTimeout(() => setMilestoneMsg(null), 4000);
      setSaving(false);
    } catch (e: any) {
      setError("Could not keep rally record: " + (e?.message ?? "Unknown error"));
      setSaving(false);
    }
  }

  async function handleRevertToNormalPermission() {
    if (!id) return;
    if (!(await confirmAction({
      title: "Remove Club Day Sharing?",
      message: "The share link and organiser settings will be removed. Your finds, sessions, photos, and tracks stay. Any imported member data will also be removed.",
      confirmLabel: "Remove Sharing",
    }))) return;

    setSaving(true);
    try {
      const perm = await db.permissions.get(id);
      const sharedId = perm?.sharedPermissionId;
      const now = new Date().toISOString();

      await db.transaction("rw", [db.permissions, db.importedPackages], async () => {
        await db.permissions.update(id, {
          isSharedPermission: false,
          sharedPermissionId: undefined,
          organiserContactNumber: undefined,
          organiserEmail: undefined,
          significantFindInstructions: undefined,
          clubDayPublicNotes: undefined,
          updatedAt: now,
        } as Partial<Permission>);

        if (sharedId) {
          await db.importedPackages
            .filter(p => p.sharedPermissionId === sharedId)
            .delete();
        }
      });

      setIsSharedPermission(false);
      setSharedPermissionId(undefined);
      setOrganiserContactNumber(undefined);
      setOrganiserEmail(undefined);
      setSignificantFindInstructions(undefined);
      setClubDayPublicNotes(undefined);
      setMilestoneMsg("Sharing removed");
      setTimeout(() => setMilestoneMsg(null), 4000);
      setSaving(false);
    } catch (e: any) {
      setError("Could not remove sharing: " + (e?.message ?? "Unknown error"));
      setSaving(false);
    }
  }

  async function handleDeleteField(fieldId: string) {
    const field = fields?.find(f => f.id === fieldId) || await db.fields.get(fieldId);
    const [sessionCount, findCount] = await Promise.all([
      db.sessions.where("fieldId").equals(fieldId).count(),
      db.finds.where("fieldId").equals(fieldId).count(),
    ]);

    if (!(await confirmAction({
      title: "Delete Field?",
      message: `Delete ${field?.name || "this field"}?\n\nThis will delete the field card and unlink:\n` +
      `- ${formatDeleteCount(sessionCount, "session")}\n` +
      `- ${formatDeleteCount(findCount, "find")}\n\n` +
      "The sessions and finds will remain on this device.",
      confirmLabel: "Delete Field",
      danger: true,
    }))) return;
    
    try {
      const now = new Date().toISOString();
      await db.transaction("rw", [db.fields, db.sessions, db.finds], async () => {
        await db.sessions.where("fieldId").equals(fieldId).modify({
          fieldId: null,
          updatedAt: now,
        });
        await db.finds.where("fieldId").equals(fieldId).modify({
          fieldId: null,
          updatedAt: now,
        });
        await db.fields.delete(fieldId);
      });
    } catch (e: any) {
      setError("Delete field failed: " + e.message);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const finalId = id || uuid();

      const permission: Permission = {
        id: finalId,
        projectId: props.projectId,
        name,
        type,
        lat,
        lon,
        gpsAccuracyM: acc,
        collector,
        landownerName,
        landownerPhone,
        landownerEmail,
        landownerAddress,
        landType,
        permissionGranted,
        validFrom,
        boundary,
        agreementId,
        notes,
        organiserContactNumber: type === "rally" ? (landownerPhone || undefined) : undefined,
        organiserEmail:         type === "rally" ? (landownerEmail || undefined) : undefined,
        createdAt: now,
        updatedAt: now,
      };

      if (isEdit) {
        const { createdAt, ...updates } = permission;
        await db.permissions.update(id, updates);

        setIsEditing(false);
        setSaved(true);
      } else {
        await db.permissions.add(permission);

        setIsEditing(false);
        if (!localStorage.getItem('fs_first_permission')) {
          localStorage.setItem('fs_first_permission', '1');
          sessionStorage.setItem('fs_pending_toast', 'Nice — your first permission is set!');
        }
        if (organiserSetupParam && type === "rally") {
          nav(`/permission/${finalId}?openClubDay=true`);
        } else {
          props.onSaved(finalId);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadExistingAgreement(file: File | null | undefined) {
    if (!file || !id) return;
    setError(null);
    try {
      const now = new Date().toISOString();
      const mediaId = uuid();
      await db.transaction("rw", [db.media, db.permissions], async () => {
        await db.media.add({
          id: mediaId,
          projectId: props.projectId,
          permissionId: id,
          type: "document",
          filename: file.name || `${type === "rally" || isSharedPermission ? "club-rally-agreement" : "landowner-agreement"}-${now.slice(0, 10)}`,
          mime: file.type || "application/octet-stream",
          blob: file,
          caption: type === "rally" || isSharedPermission ? "Uploaded club/rally agreement" : "Uploaded landowner agreement",
          scalePresent: false,
          createdAt: now,
        });
        await db.permissions.update(id, {
          agreementId: mediaId,
          permissionGranted: true,
          updatedAt: now,
        });
      });
      setAgreementId(mediaId);
      setPermissionGranted(true);
      setSaved(true);
    } catch (e: any) {
      setError("Agreement upload failed: " + (e?.message ?? "Unknown error"));
    }
  }

  if (loading) return <div className="p-10 text-center opacity-50 font-medium">Loading details...</div>;

  const isRally = type === 'rally';
  const showStarterPermissionFlow = !id && type !== "rally";
  const showOptionalPermissionDetails = !showStarterPermissionFlow || showNewPermissionDetails;
  const canManageClubDayPack = isEdit && !isClubDayMember && !isPersonalRallyRecord && (isRally || isSharedPermission);
  const attendeeFieldCount = fields?.length ?? 0;
  const canPickAttendeeFields = attendeeFieldCount > 1;
  const attendeeSelectedField = fields?.find(f => f.id === selectedFieldId) ?? null;
  const attendeeSelectedFieldCenter = attendeeSelectedField?.boundary ? getBoundaryCenter(attendeeSelectedField.boundary) : null;
  const attendeeDefaultFieldId = attendeeFieldCount === 1 ? fields?.[0]?.id : undefined;
  const notesField = fields?.find(f => f.id === notesFieldId) ?? null;
  const hasPermissionContact = !!landownerName.trim();
  const hasPermissionAccessRecord = permissionGranted || !!validFrom || !!agreementId;
  const hasPermissionMappedArea = (lat != null && lon != null) || !!boundary || (fields?.some(f => !!f.boundary) ?? false);
  const canUseAgreement = isEdit && !isClubDayMember && !isPersonalRallyRecord;
  const agreementKindLabel = isRally || isSharedPermission ? "Club/Rally Agreement" : "Agreement";
  const generateAgreementLabel = agreementId ? `Update ${agreementKindLabel}` : `Generate ${agreementKindLabel}`;
  const uploadAgreementLabel = agreementId ? "Replace Agreement File" : "Upload Signed Agreement";
  const persona = rallyPersona({ type, isClubDayMember, isPersonalRallyRecord, isSharedPermission, sharedPermissionId });
  const showOrganiserHub = isEdit && !isEditing && persona === 'organiser';
  const organiserMemberCount = submittedMembers?.length ?? 0;
  const organiserFieldCount = fields?.length ?? 0;
  const organiserFindCount = finds?.length ?? 0;
  const organiserPendingFindCount = pendingFinds?.length ?? 0;
  const submittedMemberFindCounts = new Map<string, number>();
  (finds ?? []).forEach(find => {
    const key = find.recorderId || find.recorderName?.trim();
    if (!key) return;
    submittedMemberFindCounts.set(key, (submittedMemberFindCounts.get(key) ?? 0) + 1);
  });
  const permissionNeedsCompletion = isEdit && !isRally && !isClubDayMember && (
    !hasPermissionContact || !hasPermissionAccessRecord || !hasPermissionMappedArea
  );
  const saveButtonLabel = saving
    ? "Saving..."
    : isEdit
      ? (isRally ? "Update Rally" : "Update Details")
      : isRally
        ? (organiserSetupParam ? "Save & Generate Link" : "Save Rally")
        : "Create Record";
  const permissionCoachEnabled = !!isFirstPermission && isEditing && !isRally && !isClubDayMember;
  const permissionCoachTips: CoachTip[] = [
    {
      title: "Name first",
      body: "Add the farm or field name. That is all you need to create your first permission.",
      accent: "text-emerald-300",
      border: "border-emerald-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[128px] sm:bottom-auto sm:left-1/2 sm:right-auto sm:w-[320px] sm:-translate-x-1/2",
    },
    {
      title: "Optional details",
      body: "Tap Add details now for landowner, GPS and boundaries, or keep the first record quick.",
      accent: "text-blue-300",
      border: "border-blue-400/35",
      button: "Show details",
      action: () => setShowNewPermissionDetails(true),
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[42%] sm:bottom-auto sm:left-6 sm:right-auto sm:max-w-[320px]",
    },
    {
      title: "Create record",
      body: "Save now. You can add sessions, finds, agreements and reports from the permission page.",
      accent: "text-amber-300",
      border: "border-amber-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:bottom-[92px] sm:left-1/2 sm:right-auto sm:w-[320px] sm:-translate-x-1/2",
    },
  ];

  function completePermissionDetails() {
    setShowNewPermissionDetails(true);
    setIsEditing(true);
  }

  function goRecordFind(fieldId?: string | null) {
    if (!id) return;
    const params = new URLSearchParams();
    params.set("permissionId", id);
    if (fieldId) params.set("fieldId", fieldId);
    nav(`/find?${params.toString()}`);
  }

  function handleConvertSignalToFind(signal: import("../db").UndugSignal) {
    if (!id) return;
    const params = new URLSearchParams();
    params.set("permissionId", id);
    params.set("sourceSignalId", signal.id);
    if (signal.lat != null) params.set("lat", String(signal.lat));
    if (signal.lng != null) params.set("lon", String(signal.lng));
    nav(`/find?${params.toString()}`);
  }

  const currentPermission: Permission | null = id ? {
    id, projectId: props.projectId, name, type, lat, lon, gpsAccuracyM: acc, collector,
    landownerName, landownerPhone, landownerEmail, landownerAddress,
    landType, permissionGranted, validFrom, agreementId, notes,
    isSharedPermission, sharedPermissionId,
    organiserContactNumber, organiserEmail,
    significantFindInstructions, clubDayPublicNotes,
    createdAt: "", updatedAt: ""
  } : null;

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <CoachTips
        storageKey={PERMISSION_HELPERS_SEEN_KEY}
        tips={permissionCoachTips}
        enabled={permissionCoachEnabled}
        forceShow={searchParams.get("tips") === "1"}
        mobileInline
        onDismiss={() => {
          setPermissionCoachActive(false);
          setPermissionCoachStep(0);
        }}
        onStepChange={(index) => {
          setPermissionCoachActive(true);
          setPermissionCoachStep(index);
        }}
      />
      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}
      <div className="no-print grid gap-8 mt-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
                      {isEdit ? (isRally ? "Rally Details" : "Land/Permission Details") : (isRally ? "New Rally / Club Dig" : "New Permission")}
                  </h2>
                  {canManageClubDayPack && !showOrganiserHub && !isEditing && (
                    <button
                      onClick={() => setShowCreatePack(true)}
                      className="text-[10px] text-amber-500 dark:text-amber-400 hover:text-amber-400 dark:hover:text-amber-300 transition-colors tracking-wide border-0 bg-transparent p-0 shrink-0"
                    >
                      {isSharedPermission ? "Share Link" : "Create Link"}
                    </button>
                  )}
                </div>
                {persona !== 'not_rally' && <RallyPersonaChip persona={persona} />}
                {isEdit && !isEditing && !isClubDayMember && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors border-0 bg-transparent p-0 self-start"
                  >
                    Edit Details
                  </button>
                )}
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                {isEdit && (
                    <>
                        {/* Landowner report dropdown — individual permissions only */}
                        <div className={`relative flex-1 sm:flex-none ${isRally ? 'hidden' : ''}`}>
                            <button
                                onClick={() => setReportDropdownOpen(v => !v)}
                                className="w-full text-xs sm:text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                            >
                                Landowner Report
                                <svg className={`w-3 h-3 shrink-0 transition-transform ${reportDropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </button>
                            {reportDropdownOpen && (
                                <>
                                <div className="fixed inset-0 z-40" onClick={() => setReportDropdownOpen(false)} />
                                <div
                                    className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[220px]"
                                >
                                    <div className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                                        Landowner Report
                                    </div>
                                    <button
                                        onClick={() => { setReportTarget(undefined); setReportDropdownOpen(false); }}
                                        className="w-full text-left px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-2"
                                    >
                                        <div>
                                            <div>All Finds</div>
                                            <div className="text-2xs font-normal text-gray-400">Entire permission</div>
                                        </div>
                                    </button>
                                    {fields && fields.length > 0 && (
                                        <>
                                            <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
                                                By Field
                                            </div>
                                            {fields.map(field => (
                                                <button
                                                    key={field.id}
                                                    onClick={() => { setReportTarget(field.id); setReportDropdownOpen(false); }}
                                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-2"
                                                >
                                                    {field.name}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </div>
                                </>
                            )}
                        </div>
                        {/* Club Day buttons — shown for shared/club day permissions */}
                        {isClubDayMember && (
                          <button
                            onClick={handleDeleteClubDayPermission}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                          >
                            Leave Event
                          </button>
                        )}
                        {canManageClubDayPack && !showOrganiserHub && (
                          <button
                            onClick={() => setShowCreatePack(true)}
                            className="text-xs sm:text-sm font-black text-white bg-teal-600 hover:bg-teal-500 px-3 py-1.5 rounded-lg border border-teal-600 transition-all flex-1 sm:flex-none"
                          >
                            {isSharedPermission ? "Share Join Link" : "Generate Share Link"}
                          </button>
                        )}
                        {!isClubDayMember && isEdit && isSharedPermission && !showOrganiserHub && (
                          <button
                            onClick={() => setShowImportClubDayData(true)}
                            className="text-xs sm:text-sm font-black text-teal-600 hover:text-white hover:bg-teal-600 px-3 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 transition-all flex-1 sm:flex-none"
                          >
                            Import Member Data
                          </button>
                        )}
                        {isEdit && isSharedPermission && !isClubDayMember && !isRally && (
                          <button
                            onClick={handleRevertToNormalPermission}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-600 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                          >
                            Remove Sharing
                          </button>
                        )}
                        {!isClubDayMember && (
                        <button
                            onClick={handleDelete}
                            disabled={saving}
                            className="text-xs sm:text-sm font-medium text-red-400 hover:text-red-600 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-all disabled:opacity-50 flex-1 sm:flex-none"
                        >
                            Delete
                        </button>
                        )}
                    </>
                )}
            </div>
        </div>

        {error && (
            <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm animate-in fade-in slide-in-from-top-2 font-medium flex gap-3 items-center">
                <span className="text-xl">⚠️</span> {error}
            </div>
        )}
        {saved && (
            <div className="border-2 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-4 rounded-xl shadow-sm flex flex-col gap-3">
                <div className="flex gap-3 items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-emerald-600 rounded-full flex items-center justify-center text-white font-black text-lg shrink-0">✓</div>
                        <div>
                            <div className="font-black text-emerald-700 dark:text-emerald-300">{isRally ? "Rally saved" : "Permission saved"}</div>
                            <div className="text-xs opacity-70 font-medium mt-0.5">
                                {boundary && (!fields || fields.length === 0)
                                    ? (isRally ? "Would you like to add field boundaries for this event?" : "Would you like to divide this into sub-fields?")
                                    : "Ready to use with finds, sessions, and coverage"}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => setSaved(false)} className="text-xs opacity-60 hover:opacity-100 shrink-0">Dismiss</button>
                </div>
                {boundary && (!fields || fields.length === 0) && (
                    <div className="flex gap-2 pl-12">
                        <button
                            onClick={() => { setSaved(false); setIsAddingField(true); }}
                            className="text-xs font-black bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                        >
                            {isRally ? "+ Add Rally Fields" : "+ Add Sub-Fields"}
                        </button>
                        <button
                            onClick={() => setSaved(false)}
                            className="text-xs font-black text-emerald-700 dark:text-emerald-400 px-4 py-2 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                        >
                            Not now
                        </button>
                    </div>
                )}
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 min-w-0">
            {!isEditing && isClubDayMember && (
                <div className="lg:col-span-3">
                    <div className="bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800 rounded-2xl p-5 sm:p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4 mb-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-widest text-teal-500 mb-1">Day Record</div>
                                <h3 className="text-2xl font-black text-teal-950 dark:text-teal-50 break-words">{name || "Club / Rally Event"}</h3>
                                {validFrom && (
                                    <p className="text-xs font-bold text-teal-700/70 dark:text-teal-300/70 mt-1">
                                        {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                    </p>
                                )}
                            </div>
                            <div className="shrink-0 text-xs font-mono bg-white dark:bg-gray-900 px-2 py-1 rounded font-bold text-teal-700 dark:text-teal-300 border border-teal-100 dark:border-teal-800">
                                {finds?.length ?? 0} finds
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                            <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{finds?.length ?? 0}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Recorded</div>
                            </div>
                            <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                <div className="text-lg font-black text-amber-600 dark:text-amber-300 leading-none">{pendingFinds?.length ?? 0}</div>
                                <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Pending</div>
                            </div>
                            {canPickAttendeeFields ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowAttendeeFields(v => !v);
                                        if (!selectedFieldId && fields?.[0]) setSelectedFieldId(fields[0].id);
                                    }}
                                    className={`bg-white dark:bg-gray-900/80 border rounded-xl p-3 text-left transition-colors ${showAttendeeFields ? "border-teal-500 ring-2 ring-teal-200 dark:ring-teal-900/60" : "border-teal-100 dark:border-teal-800"}`}
                                >
                                    <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{attendeeFieldCount}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                                </button>
                            ) : (
                                <div className="bg-white dark:bg-gray-900/80 border border-teal-100 dark:border-teal-800 rounded-xl p-3">
                                    <div className="text-lg font-black text-teal-700 dark:text-teal-300 leading-none">{attendeeFieldCount}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-teal-700/50 dark:text-teal-300/50 mt-1">Fields</div>
                                </div>
                            )}
                        </div>

                        {showAttendeeFields && canPickAttendeeFields && fields && fields.length > 0 && (
                            <div className="bg-white dark:bg-gray-900 border border-teal-100 dark:border-teal-800 rounded-2xl p-3 mb-4">
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                    {fields.map(field => (
                                        <button
                                            key={field.id}
                                            type="button"
                                            onClick={() => setSelectedFieldId(field.id)}
                                            className={`shrink-0 px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-colors ${selectedFieldId === field.id ? "bg-teal-600 border-teal-600 text-white" : "bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}
                                        >
                                            {field.name}
                                        </button>
                                    ))}
                                </div>
                                {attendeeSelectedField && (
                                    <div className="grid gap-3 pt-2">
                                        {attendeeSelectedFieldCenter ? (
                                            <StaticMapPreview
                                                lat={attendeeSelectedFieldCenter.lat}
                                                lon={attendeeSelectedFieldCenter.lon}
                                                boundary={attendeeSelectedField.boundary}
                                                className="h-44 rounded-xl border border-gray-200 dark:border-gray-700"
                                            />
                                        ) : (
                                            <div className="h-24 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-400">
                                                No mapped boundary
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-black text-sm text-gray-900 dark:text-gray-100 truncate">{attendeeSelectedField.name}</div>
                                                {attendeeSelectedField.notes && (
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{attendeeSelectedField.notes}</p>
                                                )}
                                            </div>
                                            <div className="shrink-0 flex gap-2">
                                                {attendeeSelectedFieldCenter && (
                                                    <button
                                                        type="button"
                                                        onClick={() => window.open(`https://www.google.com/maps?q=${attendeeSelectedFieldCenter.lat},${attendeeSelectedFieldCenter.lon}`, "_blank")}
                                                        className="bg-white dark:bg-gray-950 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Locate
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => goRecordFind(attendeeSelectedField.id)}
                                                    className="bg-teal-600 hover:bg-teal-500 text-white px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                >
                                                    Record Here
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {submittedAt && (
                            <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 font-bold">
                                Data sent to organiser on {new Date(submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                        )}

                        {significantFindInstructions && (
                            <div className="mb-4 px-3 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl">
                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Significant find</div>
                                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">{significantFindInstructions}</p>
                            </div>
                        )}

                        {finds && finds.length > 0 && (
                            <div className="mb-4 bg-white dark:bg-gray-900 border border-teal-100 dark:border-teal-800 rounded-2xl p-3">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">Finds recorded</div>
                                    <div className="text-[10px] font-black text-teal-700 dark:text-teal-300">{finds.length}</div>
                                </div>
                                <div className={`grid gap-2 ${finds.length > 5 ? "max-h-56 overflow-y-auto pr-1" : ""}`}>
                                    {finds.map((find: any) => (
                                        <button
                                            key={find.id}
                                            type="button"
                                            onClick={() => setOpenFindId(find.id)}
                                            className="w-full text-left flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 hover:border-teal-400 transition-colors"
                                        >
                                            <div className="min-w-0">
                                                <div className="text-sm font-black text-gray-800 dark:text-gray-100 truncate">{find.objectType || find.findCategory || "Unknown find"}</div>
                                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{find.notes || find.findCode}</div>
                                            </div>
                                            <div className="text-[10px] font-bold text-gray-400 shrink-0">{new Date(find.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="grid gap-2">
                            <button
                                onClick={() => goRecordFind(attendeeDefaultFieldId)}
                                className="w-full bg-teal-600 hover:bg-teal-500 text-white py-3.5 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs"
                            >
                                Record Find
                            </button>
                            <button
                                onClick={() => setShowExportClubDay(true)}
                                className="w-full bg-white dark:bg-gray-900 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 py-3 rounded-xl font-black shadow-sm hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-all uppercase tracking-widest text-xs"
                            >
                                Send Finds to Organiser
                            </button>
                            <button
                                onClick={handleKeepClubDayAsPersonalRecord}
                                disabled={saving}
                                className="w-full bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 py-3 rounded-xl font-black shadow-sm hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all uppercase tracking-widest text-xs disabled:opacity-50"
                            >
                                Keep Rally Record
                            </button>
                            {organiserContactNumber && (
                                <a
                                    href={`tel:${organiserContactNumber}`}
                                    className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3.5 rounded-xl font-black shadow-sm transition-all uppercase tracking-widest text-xs text-center"
                                >
                                    Call organiser: {organiserContactNumber}
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isEdit && !isEditing && persona === 'personal' && (
                <div className="lg:col-span-3 flex items-center justify-center gap-2 py-3 px-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Running this dig for others?</span>
                    <button
                        onClick={() => setShowCreatePack(true)}
                        className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors"
                    >
                        Create a join pack →
                    </button>
                </div>
            )}

            {showOrganiserHub && (
                <div className="lg:col-span-3" role="region" aria-label="Organiser Hub">
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 sm:p-6 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-1">Organiser Hub</div>
                                <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 break-words">{name || "Unnamed Rally"}</h3>
                                {validFrom && (
                                    <p className="text-sm text-amber-800/70 dark:text-amber-200/70 mt-0.5">
                                        {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
                                        {landownerName ? ` · ${landownerName}` : ""}
                                    </p>
                                )}
                            </div>
                            <div className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isSharedPermission ? "bg-teal-600 text-white" : "bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-200"}`}>
                                {isSharedPermission ? "Join link ready" : "Setup needed"}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
                            {[
                                { label: "Members", value: organiserMemberCount, highlight: true },
                                { label: "Fields", value: organiserFieldCount, highlight: false },
                                { label: "Finds", value: organiserFindCount, highlight: true },
                                { label: "Pending", value: organiserPendingFindCount, highlight: false },
                            ].map(stat => (
                                <div key={stat.label} className="bg-white dark:bg-gray-900/80 border border-amber-100 dark:border-amber-800/70 rounded-xl p-3">
                                    <div className={`text-xl font-black leading-none ${stat.highlight ? "text-teal-600 dark:text-teal-400" : "text-gray-900 dark:text-gray-100"}`}>{stat.value}</div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 dark:text-amber-300/60 mt-1">{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        {isSharedPermission && rallyDayReview && (rallyDayReview.totalFinds > 0 || organiserMemberCount > 0) ? (
                            <div className="mb-5">
                                <RallyDayReviewPanel review={rallyDayReview} />
                            </div>
                        ) : (
                            <div className="mb-5 flex items-center gap-4 rounded-xl bg-white/80 dark:bg-gray-900/70 border border-amber-100 dark:border-amber-800/70 p-4">
                                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400">
                                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                        <circle cx="12" cy="10" r="3" />
                                    </svg>
                                </div>
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700/70 dark:text-amber-300/70 mb-0.5">Day Summary</div>
                                    <p className="text-xs font-medium leading-relaxed text-gray-600 dark:text-gray-300 m-0">
                                        {isSharedPermission
                                          ? "Import member data to build the finds summary, activity zones and field signal for the day."
                                          : "Generate the join link first. Once members send exports back, the finds summary appears here in the hub."}
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                            <button
                                type="button"
                                onClick={() => setShowCreatePack(true)}
                                className="flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm"
                            >
                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="3" width="7" height="7" />
                                    <rect x="14" y="3" width="7" height="7" />
                                    <rect x="14" y="14" width="7" height="7" />
                                    <rect x="3" y="14" width="7" height="7" />
                                </svg>
                                {isSharedPermission ? "Share join link" : "Generate join link"}
                            </button>
                            <button
                                type="button"
                                onClick={() => isSharedPermission ? setShowImportClubDayData(true) : setShowCreatePack(true)}
                                className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shadow-sm ${isSharedPermission ? "bg-teal-800 hover:bg-teal-700 text-white" : "bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"}`}
                            >
                                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                {isSharedPermission ? "Import member data" : "Generate link first"}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <button
                                type="button"
                                onClick={() => setIsAddingField(true)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
                                </svg>
                                Add field
                            </button>
                            <button
                                type="button"
                                onClick={() => setReportTarget(undefined)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                </svg>
                                Report
                            </button>
                            <button
                                type="button"
                                onClick={() => setAgreementModalOpen(true)}
                                className="flex min-h-10 items-center justify-center gap-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 px-2.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest leading-tight transition-colors"
                            >
                                <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                </svg>
                                {agreementKindLabel}
                            </button>
                        </div>

                        {organiserMemberCount > 0 && submittedMembers && (
                            <div className="mt-5 pt-4 border-t border-amber-200/60 dark:border-amber-800/50">
                                <div className="text-[9px] font-black uppercase tracking-widest text-amber-700/60 dark:text-amber-300/60 mb-2">
                                    Submitted data · {organiserMemberCount}
                                </div>
                                <div className="space-y-1.5">
                                    {submittedMembers.map(member => {
                                        const initials = (member.recorderName || "?")
                                            .split(" ")
                                            .map((word: string) => word[0])
                                            .join("")
                                            .slice(0, 2)
                                            .toUpperCase();
                                        const memberKey = member.recorderId || member.recorderName?.trim();
                                        const memberFindCount = memberKey ? submittedMemberFindCounts.get(memberKey) ?? 0 : 0;
                                        return (
                                            <div key={member.id} className="flex items-center gap-3 bg-white/70 dark:bg-gray-900/50 border border-amber-100 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
                                                <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/60 flex items-center justify-center text-[10px] font-black text-teal-700 dark:text-teal-300 shrink-0">
                                                    {initials}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate m-0">
                                                        {member.recorderName || "Unnamed detectorist"}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                                                        {memberFindCount} {memberFindCount === 1 ? "find" : "finds"}
                                                    </span>
                                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                                                        Data sent
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isRally && isEdit && !isEditing && !isClubDayMember && (
            <div className="lg:col-span-3">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Rally / Club Dig</div>
                            <h3 className="text-2xl font-black text-gray-800 dark:text-gray-100 break-words">{name || "Unnamed Rally"}</h3>
                            {validFrom && (
                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mt-1">
                                    {new Date(validFrom).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                </p>
                            )}
                        </div>
                        <div className="shrink-0 text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-bold text-gray-600 dark:text-gray-300">
                            {finds?.length ?? 0} finds
                        </div>
                    </div>

                    {landownerName && (
                        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-gray-700">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 text-gray-500 dark:text-gray-400">Organiser / Club</div>
                            <p className="font-bold text-gray-700 dark:text-gray-300">{landownerName}</p>
                            {landownerPhone && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">📞 {landownerPhone}</p>}
                            {landownerEmail && <p className="text-sm text-gray-500 dark:text-gray-400">✉️ {landownerEmail}</p>}
                        </div>
                    )}

                    {(boundary || (lat != null && lon != null)) && (
                        <div className="mb-4">
                            {boundary && lat != null && lon != null ? (
                                <StaticMapPreview lat={lat} lon={lon} boundary={boundary} className="h-40 rounded-xl border border-gray-200 dark:border-gray-700" />
                            ) : lat != null && lon != null ? (
                                <img
                                    src={`https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lon}&zoom=13&size=600x150&markers=${lat},${lon}`}
                                    alt="Rally location"
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
                                />
                            ) : null}
                            {lat != null && lon != null && (
                                <button
                                    onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lon}`, "_blank")}
                                    className="text-[10px] font-bold text-gray-400 hover:text-emerald-600 transition-colors flex items-center gap-1 mt-1.5"
                                >
                                    View on Google Maps ↗
                                </button>
                            )}
                        </div>
                    )}

                    {finds && finds.length > 0 ? (
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-2 text-gray-500 dark:text-gray-400">Finds</div>
                            <div className={`grid gap-1.5 ${finds.length > 6 ? 'max-h-64 overflow-y-auto' : ''}`}>
                                {finds.map((f: any) => (
                                    <button
                                        key={f.id}
                                        onClick={() => setOpenFindId(f.id)}
                                        className="w-full text-left flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-emerald-400 transition-all group"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-black text-gray-800 dark:text-gray-100 truncate group-hover:text-emerald-600 transition-colors">{f.objectType || f.findCategory || "Unknown find"}</div>
                                            {f.notes && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{f.notes}</div>}
                                        </div>
                                        <div className="text-[10px] font-bold text-gray-400 shrink-0">{new Date(f.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 border-2 border-dashed border-gray-100 dark:border-gray-700 rounded-xl text-sm text-gray-400 italic">
                            {isSharedPermission ? "No finds imported yet — use Import Member Data to bring in detectorist records." : "No finds recorded for this rally yet."}
                        </div>
                    )}
                </div>
            </div>
            )}

            {(!isClubDayMember || isEditing) && (!isRally || isEditing || !isEdit || persona === 'personal' || persona === 'kept_record') && (
            <React.Fragment>
            <PermissionFieldsColumn
                permissionId={id}
                isEdit={isEdit}
                isEditing={isEditing}
                saving={saving}
                isRally={isRally}
                isClubDayMember={isClubDayMember}
                isSharedPermission={isSharedPermission}
                isPersonalRallyRecord={isPersonalRallyRecord}
                isFirstPermission={isFirstPermission}
                organiserSetupParam={organiserSetupParam}
                showOrganiserHub={showOrganiserHub}
                canUseAgreement={canUseAgreement}
                generateAgreementLabel={generateAgreementLabel}
                uploadAgreementLabel={uploadAgreementLabel}
                permissionNeedsCompletion={permissionNeedsCompletion}
                saveButtonLabel={saveButtonLabel}
                showOptionalPermissionDetails={showOptionalPermissionDetails}
                permissionCoachActive={permissionCoachActive}
                permissionCoachStep={permissionCoachStep}
                name={name}
                type={type}
                landownerName={landownerName}
                landownerPhone={landownerPhone}
                landownerEmail={landownerEmail}
                landownerAddress={landownerAddress}
                collector={collector}
                landType={landType}
                permissionGranted={permissionGranted}
                validFrom={validFrom}
                notes={notes}
                lat={lat}
                lon={lon}
                setName={setName}
                setLandownerName={setLandownerName}
                setLandownerPhone={setLandownerPhone}
                setLandownerEmail={setLandownerEmail}
                setLandownerAddress={setLandownerAddress}
                setCollector={setCollector}
                setLandType={setLandType}
                setPermissionGranted={setPermissionGranted}
                setValidFrom={setValidFrom}
                setNotes={setNotes}
                setLat={setLat}
                setLon={setLon}
                boundary={boundary}
                fields={fields}
                finds={finds}
                sessions={sessions}
                pendingFinds={pendingFinds}
                allTracks={allTracks}
                fieldFindCounts={fieldFindCounts}
                submittedMembers={submittedMembers}
                agreementFile={agreementFile}
                submittedAt={submittedAt}
                significantFindInstructions={significantFindInstructions}
                organiserContactNumber={organiserContactNumber}
                clubDayPublicNotes={clubDayPublicNotes}
                insuranceProvider={insuranceProvider}
                ncmdNumber={ncmdNumber}
                ncmdExpiry={ncmdExpiry}
                onSave={save}
                onDoGPS={doGPS}
                onDeleteField={handleDeleteField}
                onRecordFind={goRecordFind}
                onAddField={() => setIsAddingField(true)}
                onEditField={setEditingFieldId}
                onShowFieldNotes={setNotesFieldId}
                onOpenAgreement={() => setAgreementModalOpen(true)}
                onOpenProof={() => setProofModalOpen(true)}
                onPickBoundary={() => setIsPickingBoundary(true)}
                onPickLocation={() => setIsPickingLocation(true)}
                onCancelEdit={() => setIsEditing(false)}
                onShowAllDetails={() => setShowNewPermissionDetails(true)}
                onCompletePermission={completePermissionDetails}
                onUploadAgreement={uploadExistingAgreement}
                onShowExportClubDay={() => setShowExportClubDay(true)}
            />

            <PermissionActivityColumn
                isEdit={isEdit}
                permissionId={id}
                pendingFinds={pendingFinds}
                standaloneFinds={standaloneFinds}
                finds={finds}
                sessions={sessions}
                fields={fields}
                allMedia={allMedia}
                isClubDayMember={isClubDayMember}
                isRally={isRally}
                persona={persona}
                name={name}
                landownerName={landownerName}
                landownerPhone={landownerPhone}
                landownerEmail={landownerEmail}
                validFrom={validFrom}
                lat={lat}
                lon={lon}
                saving={saving}
                onOpenFind={setOpenFindId}
                onRecordFind={goRecordFind}
                onKeepClubDayAsPersonalRecord={handleKeepClubDayAsPersonalRecord}
                onShowExportClubDay={() => setShowExportClubDay(true)}
                confirmAction={confirmAction}
                onConvertSignalToFind={handleConvertSignalToFind}
            />

            {/* Offline Access card — regular permissions with a mapped boundary */}
            {isEdit && !isClubDayMember && !isEditing && !!boundary && (
                <div className="lg:col-span-3">
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm">
                        <div className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Offline Access</div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Download terrain, historic data and scheduled monument layers so FieldGuide works without a signal.</p>

                        {permPackStatus.kind === 'checking' && (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                <div className="w-3 h-3 rounded-full border border-gray-300 border-t-transparent animate-spin" />
                                Checking…
                            </div>
                        )}

                        {permPackStatus.kind === 'none' && (
                            <button
                                onClick={handlePackPrepare}
                                className="flex items-center gap-2 text-sm font-black text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors"
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
                                Prepare for Offline (~{permPackStatus.estMB})
                            </button>
                        )}

                        {permPackStatus.kind === 'building' && (
                            <div className="flex items-center gap-3">
                                <div className="flex-1 max-w-xs h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${permPackStatus.pct}%` }} />
                                </div>
                                <span className="text-xs text-gray-400 shrink-0">{permPackStatus.pct}%</span>
                                <div className="w-3 h-3 rounded-full border border-emerald-400/40 border-t-emerald-500 animate-spin shrink-0" />
                            </div>
                        )}

                        {permPackStatus.kind === 'done' && (
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={permPackStatus.stale ? '#f59e0b' : '#10b981'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
                                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                        {formatMB(permPackStatus.meta.sizeBytesApprox)} downloaded
                                        {permPackStatus.stale && <span className="ml-1 text-amber-500"> · pack is old</span>}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 ml-auto">
                                    {permPackStatus.stale && (
                                        <button
                                            onClick={handlePackPrepare}
                                            className="text-xs font-black text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors"
                                        >
                                            Re-prepare
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (pendingEvictPerm) {
                                                handlePackEvict();
                                            } else {
                                                setPendingEvictPerm(true);
                                                setTimeout(() => setPendingEvictPerm(false), 3000);
                                            }
                                        }}
                                        className={`text-xs font-bold transition-colors ${pendingEvictPerm ? 'text-amber-500' : 'text-gray-400 hover:text-red-500'}`}
                                    >
                                        {pendingEvictPerm ? 'Tap again to remove' : 'Remove offline data'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {permPackStatus.kind === 'error' && (
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-red-500">Download failed.</span>
                                <button
                                    onClick={handlePackPrepare}
                                    className="text-xs font-black text-red-500 hover:text-red-400 transition-colors"
                                >
                                    Retry
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {isEdit && id && (
              <div id="outstanding-questions-section" className="lg:col-span-3 scroll-mt-4">
                <OutstandingQuestionsCard permissionId={id} />
              </div>
            )}
            </React.Fragment>
            )}

            </div>
        </div>

      {isEdit && id && reportTarget !== null && (
        <PermissionReportModal
          permissionId={id}
          fieldId={reportTarget}
          onClose={() => setReportTarget(null)}
        />
      )}

      {openFindId && <FindModal findId={openFindId} onClose={() => setOpenFindId(null)} />}
      
      {agreementModalOpen && currentPermission && (
        <AgreementModal 
          permission={currentPermission} 
          onClose={() => setAgreementModalOpen(false)} 
          onSaved={(mediaId) => {
            setAgreementId(mediaId);
          }}
        />
      )}

      {isPickingLocation && (
          <LocationPickerModal 
              initialLat={lat}
              initialLon={lon}
              onClose={() => setIsPickingLocation(false)}
              onSelect={(pickedLat, pickedLon) => {
                  setLat(pickedLat);
                  setLon(pickedLon);
                  setAcc(null);
                  setIsPickingLocation(false);
              }}
          />
      )}

      {isPickingBoundary && (
          <BoundaryPickerModal 
              initialBoundary={boundary}
              initialLat={lat}
              initialLon={lon}
              onClose={() => setIsPickingBoundary(false)}
              onSelect={(pickedBoundary) => {
                  setBoundary(pickedBoundary);
                  setIsPickingBoundary(false);
              }}
          />
      )}

      {(isAddingField || editingFieldId) && (
         <FieldModal 
             projectId={props.projectId}
             permissionId={id!}
             permissionBoundary={boundary}
             permissionLat={lat}
             permissionLon={lon}
             field={fields?.find(f => f.id === editingFieldId)}
             onClose={() => {
               setIsAddingField(false);
               setEditingFieldId(null);
             }}
             onSaved={() => {
               setIsAddingField(false);
               setEditingFieldId(null);
             }}
         />
      )}

      {notesField && (
        <FieldNotesModal
          field={notesField}
          readOnly={isClubDayMember}
          onClose={() => setNotesFieldId(null)}
        />
      )}

      {proofModalOpen && currentPermission && (
        <PermissionProofModal
          permission={{...currentPermission, id: id!}}
          agreementFile={agreementFile || null}
          insuranceProvider={insuranceProvider}
          ncmdNumber={ncmdNumber}
          ncmdExpiry={ncmdExpiry}
          onClose={() => setProofModalOpen(false)}
        />
      )}

      {showCreatePack && id && (
        <CreateClubDayPackModal
          permissionId={id}
          permissionName={name}
          organiserContactNumber={isRally ? (landownerPhone || organiserContactNumber) : organiserContactNumber}
          organiserEmail={isRally ? (landownerEmail || organiserEmail) : organiserEmail}
          significantFindInstructions={significantFindInstructions}
          clubDayPublicNotes={clubDayPublicNotes}
          eventDate={validFrom || undefined}
          fields={fields ?? []}
          onClose={() => {
            setShowCreatePack(false);
            // Reload shared permission state
            db.permissions.get(id).then(p => {
              if (p) {
                setName(p.name);
                setType(p.type || "individual");
                setValidFrom(p.validFrom || "");
                setIsSharedPermission(!!p.isSharedPermission);
                setSharedPermissionId(p.sharedPermissionId);
                setOrganiserContactNumber(p.organiserContactNumber);
                setOrganiserEmail(p.organiserEmail);
                setSignificantFindInstructions(p.significantFindInstructions);
                setClubDayPublicNotes(p.clubDayPublicNotes);
              }
            });
          }}
        />
      )}

      {showExportClubDay && id && sharedPermissionId && (
        <ExportClubDayModal
          permissionId={id}
          sharedPermissionId={sharedPermissionId}
          permissionName={name}
          organiserEmail={organiserEmail}
          onClose={() => setShowExportClubDay(false)}
        />
      )}

      {showImportClubDayData && (
        <ImportClubDayDataModal
          onClose={() => setShowImportClubDayData(false)}
        />
      )}

      {confirmDialog}

    </div>
  );
}
