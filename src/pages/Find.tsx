import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { Media, Find } from "../db";
import { pagePersistence } from "../services/pagePersistence";
import { v4 as uuid } from "uuid";
import { fileToBlob } from "../services/photos";
import { captureGPS, toOSGridRef } from "../services/gps";
import { getSetting, setSetting, getOrCreateRecorderId } from "../services/data";
import { ScaledImage } from "../components/ScaledImage";
import { CoachTip, CoachTips } from "../components/CoachTips";
import type { WorkflowState } from "../types/significantFind";
import { ephemeralLocal, useDurableSetting } from '../services/clientStorage';
import {
  addFindPhotos,
  createPhotoDraftFind,
  discardFindDraft,
  resolveFindPermission,
  saveCompletedFind,
  savePendingFind,
} from '../services/findMutations';

const LocationPickerModal = React.lazy(() =>
  import("../components/LocationPickerModal").then((mod) => ({ default: mod.LocationPickerModal }))
);

const periods: Find["period"][] = [
  "Prehistoric", "Bronze Age", "Iron Age", "Celtic", "Roman", "Anglo-Saxon", "Early Medieval", "Medieval", "Post-medieval", "Modern", "Unknown",
];
const materials: Find["material"][] = [
  "Gold", "Silver", "Copper alloy", "Lead", "Iron", "Tin", "Pewter", "Pottery", "Flint", "Stone", "Glass", "Bone", "Other",
];
const coinMaterials: Find["material"][] = [
  "Gold", "Silver", "50% Silver", "Copper alloy", "Copper", "Cupro-Nickel", "Tin", "Other",
];
const completenesses: Find["completeness"][] = ["Complete", "Incomplete", "Fragment"];

const DRAFT_KEY = "fs_find_draft";
const FIRST_FIND_KEY = "fs_first_find";
const FIND_HELPERS_SEEN_KEY = "fs_find_helpers_seen";

const toFloat = (v: string): number | null => { const n = parseFloat(v); return isFinite(n) ? n : null; };

function makeFindCode(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 900000) + 100000;
  return `FS-${year}-${rand}`;
}

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex justify-between items-center px-4 py-3 bg-gray-50 dark:bg-gray-800/60 text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pt-4 pb-4 grid gap-4">
          {children}
        </div>
      )}
    </div>
  );
}

type FormState = {
  findCode: string;
  objectType: string;
  findCategory: Find["findCategory"] | "";
  coinType: string;
  coinDenomination: string;
  coinSpink: string;
  ruler: string;
  mint: string;
  lat: number | null;
  lon: number | null;
  acc: number | null;
  osGridRef: string;
  w3w: string;
  period: Find["period"];
  material: Find["material"];
  weightG: string;
  widthMm: string;
  heightMm: string;
  depthMm: string;
  decoration: string;
  completeness: Find["completeness"];
  findContext: string;
  detector: string;
  targetId: string;
  depthCm: string;
  dateRange: string;
  storageLocation: string;
  notes: string;
  foundDate: string; // YYYY-MM-DD
  foundTime: string; // HH:MM
};

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function makeInitialForm(initialLat?: number | null, initialLon?: number | null): FormState {
  const hasInitialLocation = initialLat != null && initialLon != null;
  return {
    findCode: makeFindCode(),
    objectType: "",
    findCategory: "",
    coinType: "",
    coinDenomination: "",
    coinSpink: "",
    ruler: "",
    mint: "",
    lat: initialLat ?? null,
    lon: initialLon ?? null,
    acc: null,
    osGridRef: hasInitialLocation ? toOSGridRef(initialLat, initialLon) || "" : "",
    w3w: "",
    period: "Roman",
    material: "Copper alloy",
    weightG: "",
    widthMm: "",
    heightMm: "",
    depthMm: "",
    decoration: "",
    completeness: "Complete",
    findContext: "",
    detector: "",
    targetId: "",
    depthCm: "",
    dateRange: "",
    storageLocation: "",
    notes: "",
    foundDate: todayDate(),
    foundTime: currentTime(),
  };
}

export default function FindPage(props: {
  projectId: string;
  permissionId: string | null;
  sessionId: string | null;
  fieldId: string | null;
  quickId: string | null;
  initialLat?: number | null;
  initialLon?: number | null;
  initialMode?: "quick" | "full" | null;
  manual?: boolean;
  sourceSignalId?: string | null;
  onSignificantFind?: (initialContext?: Partial<WorkflowState>) => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [locationName, setLocationName] = useState("");
  const [fieldId, setFieldId] = useState<string | null>(props.fieldId);
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId);

  // #1 — Quick/Full mode (default: quick for new users, full for existing)
  const [storedRecordMode, setStoredRecordMode, recordModeReady] = useDurableSetting<'quick' | 'full'>('findRecordMode', 'quick');
  const [onboardingDone] = useDurableSetting('fs_onboarding_done', false);
  const [recordMode, setRecordMode] = useState<"quick" | "full">(() => {
    if (props.initialMode) return props.initialMode;
    if (props.sessionId && !props.quickId) return "quick";
    return 'quick';
  });
  useEffect(() => {
    if (!recordModeReady || props.initialMode || (props.sessionId && !props.quickId)) return;
    setRecordMode(storedRecordMode === 'quick' && onboardingDone ? 'full' : storedRecordMode);
  }, [onboardingDone, props.initialMode, props.quickId, props.sessionId, recordModeReady, storedRecordMode]);
  const changeMode = (m: "quick" | "full") => {
    setRecordMode(m);
    if (!props.sessionId) setStoredRecordMode(m);
  };

  const permissions = useLiveQuery(
    async () => pagePersistence.permissions.where("projectId").equals(props.projectId).reverse().sortBy("createdAt"),
    [props.projectId]
  );

  const session = useLiveQuery(
    async () => sessionId ? pagePersistence.sessions.get(sessionId) : null,
    [sessionId]
  );

  useEffect(() => {
    if (session?.fieldId) setFieldId(session.fieldId);
  }, [session]);

  useEffect(() => {
    if (props.fieldId && !session?.fieldId) setFieldId(props.fieldId);
  }, [props.fieldId, session?.fieldId]);

  const currentPermissionId = useMemo(() => {
    if (props.permissionId) return props.permissionId;
    return permissions?.find(p => locationName && p.name.toLowerCase() === locationName.toLowerCase())?.id || null;
  }, [props.permissionId, permissions, locationName]);

  const currentPermission = useMemo(
    () => permissions?.find(p => p.id === currentPermissionId) ?? null,
    [permissions, currentPermissionId]
  );

  useEffect(() => {
    if (currentPermissionId) {
      if (session && session.permissionId !== currentPermissionId) {
        setSessionId(null);
        setFieldId(null);
      }
    }
  }, [currentPermissionId, session]);

  const fields = useLiveQuery(async () => {
    if (!currentPermissionId) return [];
    return pagePersistence.fields.where("permissionId").equals(currentPermissionId).toArray();
  }, [currentPermissionId]);

  // #12 — current field for context strip
  const currentField = useLiveQuery(async () => {
    if (!fieldId) return null;
    return pagePersistence.fields.get(fieldId);
  }, [fieldId]);

  const availableSessions = useLiveQuery(async () => {
    if (!currentPermissionId) return [];
    return pagePersistence.sessions.where("permissionId").equals(currentPermissionId).reverse().sortBy("date");
  }, [currentPermissionId]);

  const sessionOptions = useMemo(() => {
    const rows = availableSessions ?? [];
    if (!session || rows.some(s => s.id === session.id)) return rows;
    return [session, ...rows];
  }, [availableSessions, session]);

  const [form, setForm] = useState<FormState>(() => makeInitialForm(props.initialLat, props.initialLon));
  const [detectors, setDetectors] = useState<string[]>([]);

  // update() — called by user interactions; tracks modification for draft auto-save
  const [userModified, setUserModified] = useState(false);
  const update = (patch: Partial<FormState>) => {
    setUserModified(true);
    setForm(prev => ({ ...prev, ...patch }));
  };
  // Wrapper for locationName changes from user input
  const updateLocation = (v: string) => {
    setUserModified(true);
    setLocationName(v);
  };

  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  // dbDraftId: auto-created DB record to hold photos before the user explicitly saves.
  // Does NOT trigger the green banner or form lockout — only savedId does.
  const [dbDraftId, setDbDraftId] = useState<string | null>(null);
  const dbDraftIdRef = useRef<string | null>(null);
  const committedDraftIdsRef = useRef<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);

  // #5 — GPS capturing state
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [gpsElapsed, setGpsElapsed] = useState(0);
  const gpsAcceptRef = useRef<{ accept: (() => void) | null }>({ accept: null });
  const gpsStartRef = useRef<number | null>(null);
  const gpsElapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);
  const [hasRecordedFindBefore, setHasRecordedFindBefore] = useDurableSetting(FIRST_FIND_KEY, false);
  const [findCoachActive, setFindCoachActive] = useState(false);
  const [findCoachStep, setFindCoachStep] = useState(0);

  // #14 — draft restore flag
  const [draftRestored, setDraftRestored] = useState(false);
  const [loadedFindIsPending, setLoadedFindIsPending] = useState(false);

  // Collapsible section state — Basic open by default, rest collapsed
  const [openSections, setOpenSections] = useState({
    basic: true,
    measurements: false,
    advanced: false,
    detector: false,
  });
  const toggleSection = (s: keyof typeof openSections) =>
    setOpenSections(prev => ({ ...prev, [s]: !prev[s] }));

  const stickyPhotoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dbDraftIdRef.current = dbDraftId;
  }, [dbDraftId]);

  useEffect(() => {
    return () => {
      const draftId = dbDraftIdRef.current;
      if (!draftId || committedDraftIdsRef.current.has(draftId)) return;
      discardFindDraft(draftId).catch((e) => console.error("Failed to clean up abandoned photo draft", e));
    };
  }, []);

  // Load settings — uses setForm directly, not update(), to avoid triggering userModified
  useEffect(() => {
    getSetting("detectors", []).then(setDetectors);
    getSetting("defaultDetector", "").then(d => {
      if (d) setForm(prev => ({ ...prev, detector: d as string }));
    });
    getSetting("lastPeriod", "Roman").then(p => setForm(prev => ({ ...prev, period: p as Find["period"] })));
    getSetting("lastMaterial", "Copper alloy").then(m => setForm(prev => ({ ...prev, material: m as Find["material"] })));
    getSetting("lastDepthCm", "").then(d => { if (d) setForm(prev => ({ ...prev, depthCm: d as string })); });
  }, []);

  // #14 — restore draft on mount (silent, no prompt)
  useEffect(() => {
    if (props.quickId || props.permissionId || props.sourceSignalId) return;
    const raw = ephemeralLocal.get(DRAFT_KEY);
    if (!raw) return;
    try {
      const { form: draftForm, locationName: draftLoc, sessionId: draftSessionId, fieldId: draftFieldId } = JSON.parse(raw);
      setForm(prev => ({ ...prev, ...draftForm }));
      if (draftLoc) setLocationName(draftLoc);
      if (draftSessionId) setSessionId(draftSessionId);
      if (draftFieldId) setFieldId(draftFieldId);
      setDraftRestored(true);
    } catch {
      ephemeralLocal.remove(DRAFT_KEY);
    }
  }, []);

  // #14 — auto-save draft to localStorage (2s debounce after user modifies)
  useEffect(() => {
    if (!userModified || savedId || props.quickId) return;
    const timer = setTimeout(() => {
      ephemeralLocal.set(DRAFT_KEY, JSON.stringify({ form, locationName, sessionId, fieldId }));
    }, 2000);
    return () => clearTimeout(timer);
  }, [form, locationName, userModified, savedId, props.quickId]);

  function clearDraft() {
    ephemeralLocal.remove(DRAFT_KEY);
    setDraftRestored(false);
  }

  useEffect(() => {
    if (props.quickId) {
      pagePersistence.finds.get(props.quickId).then(f => {
        if (f) {
          setSavedId(f.id);
          setLoadedFindIsPending(!!f.isPending);
          const grid = (f.lat != null && f.lon != null) ? toOSGridRef(f.lat, f.lon) || "" : "";
          const src = f.foundAt ? new Date(f.foundAt) : null;
          setForm(prev => ({
            ...prev,
            findCode: f.findCode,
            objectType: f.objectType === "Pending Quick Find" ? "" : f.objectType,
            findCategory: f.findCategory || "",
            coinType: f.coinType || "",
            coinDenomination: f.coinDenomination || "",
            coinSpink: f.coinSpink || "",
            ruler: f.ruler || "",
            mint: f.mint || "",
            lat: f.lat,
            lon: f.lon,
            acc: f.gpsAccuracyM,
            osGridRef: grid,
            notes: f.notes,
            foundDate: src
              ? `${src.getFullYear()}-${String(src.getMonth()+1).padStart(2,"0")}-${String(src.getDate()).padStart(2,"0")}`
              : todayDate(),
            foundTime: src
              ? `${String(src.getHours()).padStart(2,"0")}:${String(src.getMinutes()).padStart(2,"0")}`
              : currentTime(),
          }));
          if (f.permissionId) {
            pagePersistence.permissions.get(f.permissionId).then(p => {
              if (p) setLocationName(p.name);
            });
          }
          if (f.sessionId) setSessionId(f.sessionId);
          if (f.fieldId) setFieldId(f.fieldId);
        }
      });
    }
  }, [props.quickId]);

  useEffect(() => {
    if (props.permissionId) {
      pagePersistence.permissions.get(props.permissionId).then(l => {
        if (l) setLocationName(l.name);
      });
    } else if (permissions && permissions.length > 0 && !locationName && !props.quickId) {
      setLocationName(permissions[0].name || "");
    }
  }, [props.permissionId, permissions, props.quickId]);

  // Auto-capture GPS on mount if not editing and not manual entry mode
  useEffect(() => {
    if (form.lat == null && !props.quickId && !savedId && !props.manual) {
      doGPS();
    }
  }, []);

  const media = useLiveQuery(
    async () => {
      const id = savedId || dbDraftId;
      return id ? pagePersistence.media.where("findId").equals(id).toArray() : [];
    },
    [savedId, dbDraftId]
  );

  async function doGPS() {
    setError(null);
    setGpsCapturing(true);
    setLiveAccuracy(null);
    setGpsElapsed(0);
    gpsAcceptRef.current.accept = null;
    gpsStartRef.current = Date.now();
    gpsElapsedInterval.current = setInterval(() => {
      if (gpsStartRef.current !== null) setGpsElapsed(Date.now() - gpsStartRef.current);
    }, 500);
    try {
      const fix = await captureGPS({ onProgress: setLiveAccuracy, acceptRef: gpsAcceptRef.current });
      const grid = toOSGridRef(fix.lat, fix.lon);
      setForm(prev => ({ ...prev, lat: fix.lat, lon: fix.lon, acc: fix.accuracyM, osGridRef: grid || prev.osGridRef }));
    } catch (e: any) {
      setError(e?.message ?? "GPS failed");
    } finally {
      if (gpsElapsedInterval.current !== null) clearInterval(gpsElapsedInterval.current);
      gpsElapsedInterval.current = null;
      gpsStartRef.current = null;
      gpsAcceptRef.current.accept = null;
      setGpsCapturing(false);
      setLiveAccuracy(null);
      setGpsElapsed(0);
    }
  }

  function resetForm() {
    setSavedId(null);
    setDbDraftId(null);
    setForm({ ...makeInitialForm(), findCode: makeFindCode() });
    setUserModified(false);
    clearDraft();
    setError(null);
  }

  // Shared permission resolution used by both saveFind and saveAsPending
  async function resolvePermission(trimmedName: string, now: string, preferredPermissionId?: string | null): Promise<string> {
    const defaultDetectorist = await getSetting("detectorist", "");
    const newId = uuid();
    return resolveFindPermission({
      projectId: props.projectId,
      preferredPermissionId,
      name: trimmedName,
      collector: defaultDetectorist as string,
      permissionId: newId,
      now,
    });
  }

  async function getClubDayAttribution(permissionId: string): Promise<{ sharedPermissionId?: string; recorderId?: string; recorderName?: string }> {
    const perm = await pagePersistence.permissions.get(permissionId);
    const sharedId = perm?.sharedPermissionId || (perm?.isClubDayMember ? perm.id : undefined);
    if (!sharedId) return {};
    const [recorderId, recorderName] = await Promise.all([
      getOrCreateRecorderId(),
      getSetting<string>("recorderName", "Unnamed detectorist"),
    ]);
    return { sharedPermissionId: sharedId, recorderId, recorderName };
  }

  async function saveFind(): Promise<string | null> {
    setError(null);
    setSaving(true);
    try {
      const trimmedName = locationName.trim() || "No Location";
      const id = savedId || dbDraftId || props.quickId || uuid();
      const isEditMode = !!(savedId || dbDraftId || props.quickId);
      const now = new Date().toISOString();
      const targetPermissionId = await resolvePermission(trimmedName, now, currentPermissionId);

      const foundAt = form.foundDate
        ? new Date(`${form.foundDate}T${form.foundTime || "00:00"}`).toISOString()
        : undefined;

      const clubDayAttribution = isEditMode ? {} : await getClubDayAttribution(targetPermissionId);

      const s: Omit<Find, 'createdAt'> = {
        id,
        projectId: props.projectId,
        permissionId: targetPermissionId,
        ...clubDayAttribution,
        fieldId,
        sessionId,
        findCode: form.findCode.trim() || makeFindCode(),
        objectType: form.objectType.trim(),
        findCategory: form.findCategory || undefined,
        coinType: form.coinType.trim(),
        coinDenomination: form.coinDenomination.trim(),
        coinSpink: form.coinSpink.trim() || undefined,
        ruler: form.ruler.trim(),
        mint: form.mint.trim() || undefined,
        lat: form.lat,
        lon: form.lon,
        gpsAccuracyM: form.acc,
        osGridRef: form.osGridRef,
        w3w: form.w3w.trim(),
        period: form.period,
        material: form.material,
        weightG: toFloat(form.weightG),
        widthMm: toFloat(form.widthMm),
        heightMm: toFloat(form.heightMm),
        depthMm: toFloat(form.depthMm),
        detector: form.detector || undefined,
        targetId: form.targetId ? parseInt(form.targetId) : undefined,
        depthCm: toFloat(form.depthCm) ?? undefined,
        decoration: form.decoration.trim(),
        completeness: form.completeness,
        findContext: form.findContext.trim(),
        dateRange: form.dateRange.trim() || undefined,
        storageLocation: form.storageLocation.trim(),
        notes: form.notes.trim(),
        isPending: false,
        foundAt,
        updatedAt: now,
        sourceSignalId: props.sourceSignalId ?? undefined,
      };

      await saveCompletedFind(s, {
        existing: !!(props.quickId || isEditMode),
        createdAt: now,
        sourceSignalId: props.sourceSignalId,
      });

      setSetting("lastPeriod", form.period);
      setSetting("lastMaterial", form.material);
      if (form.detector) setSetting("defaultDetector", form.detector);
      if (form.depthCm) setSetting("lastDepthCm", form.depthCm);

      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

      clearDraft();
      setUserModified(false);
      committedDraftIdsRef.current.add(id);
      setSavedId(id);

      const isFirstFind = !hasRecordedFindBefore;
      if (isFirstFind) setHasRecordedFindBefore(true);
      if (isFirstFind) {
        setHasRecordedFindBefore(true);
        setMilestoneMsg('Nice — your first find recorded!');
        setTimeout(() => setMilestoneMsg(null), 4000);
      }

      if (props.quickId) {
        setTimeout(() => navigate("/"), 500);
      }
      return id;
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        setError("Device storage full — go to Settings to back up and free space.");
      } else {
        setError(e?.message ?? "Save failed");
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  // #1 — "Finish Later": save as pending find and return to home
  async function saveAsPending() {
    setSaving(true);
    try {
      const trimmedName = locationName.trim() || "No Location";
      // If a photo draft already exists, update it rather than creating a duplicate
      const id = dbDraftId || uuid();
      const now = new Date().toISOString();
      const targetPermissionId = await resolvePermission(trimmedName, now, currentPermissionId);

      const foundAt = form.foundDate
        ? new Date(`${form.foundDate}T${form.foundTime || "00:00"}`).toISOString()
        : undefined;

      const clubDayAttribution = dbDraftId ? {} : await getClubDayAttribution(targetPermissionId);

      const pendingData: Omit<Find, 'createdAt'> = {
        id,
        projectId: props.projectId,
        permissionId: targetPermissionId,
        ...clubDayAttribution,
        fieldId,
        sessionId,
        findCode: form.findCode.trim() || makeFindCode(),
        objectType: form.objectType.trim() || "Pending Quick Find",
        findCategory: form.findCategory || undefined,
        coinType: form.coinType.trim(),
        coinDenomination: form.coinDenomination.trim(),
        coinSpink: form.coinSpink.trim() || undefined,
        ruler: form.ruler.trim(),
        mint: form.mint.trim() || undefined,
        lat: form.lat,
        lon: form.lon,
        gpsAccuracyM: form.acc,
        osGridRef: form.osGridRef,
        w3w: form.w3w.trim(),
        period: form.period,
        material: form.material,
        weightG: null,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        detector: form.detector || undefined,
        targetId: undefined,
        depthCm: toFloat(form.depthCm) ?? undefined,
        decoration: "",
        completeness: form.completeness,
        findContext: "",
        dateRange: undefined,
        storageLocation: "",
        notes: form.notes.trim(),
        isPending: true,
        foundAt,
        updatedAt: now,
      };

      await savePendingFind(pendingData, { existing: !!dbDraftId, createdAt: now });

      if (navigator.vibrate) navigator.vibrate([50]);
      committedDraftIdsRef.current.add(id);
      clearDraft();
      navigate("/");
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Creates a minimal pending DB record solely to anchor photos, without triggering
  // the saved state or locking the form. Used by addPhotos when no record exists yet.
  async function saveDraftForPhoto(): Promise<string | null> {
    try {
      const trimmedName = locationName.trim() || "No Location";
      const id = uuid();
      const now = new Date().toISOString();
      const permId = await resolvePermission(trimmedName, now, currentPermissionId);
      const clubDayAttribution = await getClubDayAttribution(permId);
      await createPhotoDraftFind({
        id,
        projectId: props.projectId,
        permissionId: permId,
        ...clubDayAttribution,
        fieldId,
        sessionId,
        findCode: form.findCode.trim() || makeFindCode(),
        objectType: form.objectType.trim() || "",
        findCategory: form.findCategory || undefined,
        coinType: form.coinType.trim(),
        coinDenomination: form.coinDenomination.trim(),
        coinSpink: form.coinSpink.trim() || undefined,
        ruler: form.ruler.trim(),
        mint: form.mint.trim() || undefined,
        lat: form.lat, lon: form.lon, gpsAccuracyM: form.acc,
        osGridRef: form.osGridRef, w3w: "",
        period: form.period, material: form.material,
        weightG: null, widthMm: null, heightMm: null, depthMm: null,
        detector: undefined, targetId: undefined, depthCm: undefined,
        decoration: "", completeness: form.completeness, findContext: "",
        dateRange: undefined, storageLocation: "",
        notes: form.notes.trim(),
        isPending: true,
        createdAt: now, updatedAt: now,
      });
      setDbDraftId(id);
      return id;
    } catch (e: any) {
      setError(e?.message ?? "Failed to prepare photo record");
      return null;
    }
  }

  // #4 — photos no longer require a prior explicit save
  async function addPhotos(files: FileList | null, photoType?: Media["photoType"]) {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      let targetId = savedId || dbDraftId;
      if (!targetId) {
        targetId = await saveDraftForPhoto();
        if (!targetId) return;
      }

      const now = new Date().toISOString();
      const items: Media[] = [];

      for (const f of Array.from(files)) {
        const blob = await fileToBlob(f);
        items.push({
          id: uuid(),
          projectId: props.projectId,
          findId: targetId,
          type: "photo",
          photoType: photoType || "other",
          filename: f.name,
          mime: f.type || "application/octet-stream",
          blob,
          caption: "",
          scalePresent: false,
          createdAt: now,
        });
      }

      await addFindPhotos(items);
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        setError("Device storage full — go to Settings to back up and free space.");
      } else {
        setError(e?.message ?? "Photo add failed");
      }
    }
  }

  function PhotoThumb(props: { mediaId: string; filename: string; photoType?: string }) {
    const [media, setMedia] = useState<Media | null>(null);

    useEffect(() => {
      let active = true;
      pagePersistence.media.get(props.mediaId).then(m => {
        if (active && m) setMedia(m);
      });
      return () => { active = false; };
    }, [props.mediaId]);

    if (!media) return <div className="w-full h-32 bg-gray-100 dark:bg-gray-700 animate-pulse rounded-lg" />;

    return (
      <div className="relative group border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden aspect-square">
        <ScaledImage media={media} imgClassName="object-cover" className="w-full h-full" />
        <div className="bg-white/90 dark:bg-gray-900/90 p-1 text-[10px] truncate absolute bottom-0 inset-x-0 z-10 flex justify-between items-center">
          <span>{props.filename}</span>
          {media.photoType && (
            <span className={`px-1 rounded uppercase text-[8px] font-bold ${media.photoType === 'in-situ' ? 'bg-amber-100 text-amber-800' : media.photoType === 'cleaned' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
              {media.photoType === 'in-situ' ? 'In Situ' : media.photoType === 'cleaned' ? 'Cleaned' : media.photoType}
            </span>
          )}
        </div>
      </div>
    );
  }

  // #5 — GPS status line derived from current accuracy
  const gpsStatus = useMemo(() => {
    if (gpsCapturing) {
      if (liveAccuracy !== null) {
        if (liveAccuracy <= 10) return { label: `Acquiring… ±${Math.round(liveAccuracy)}m`, color: "text-emerald-600 dark:text-emerald-400" };
        if (liveAccuracy <= 30) return { label: `Acquiring… ±${Math.round(liveAccuracy)}m`, color: "text-amber-600 dark:text-amber-400" };
        return { label: `Acquiring… ±${Math.round(liveAccuracy)}m`, color: "text-red-500 dark:text-red-400" };
      }
      return { label: "Acquiring GPS…", color: "text-gray-500 dark:text-gray-400" };
    }
    if (form.lat == null || form.lon == null) return null;
    const acc = form.acc;
    if (acc === null) return { label: "Location set", color: "text-emerald-600 dark:text-emerald-400" };
    if (acc <= 10) return { label: `GPS Good: ${Math.round(acc)}m`, color: "text-emerald-600 dark:text-emerald-400" };
    if (acc <= 30) return { label: `GPS Fair: ${Math.round(acc)}m`, color: "text-amber-600 dark:text-amber-400" };
    return { label: `GPS Poor: ${Math.round(acc)}m`, color: "text-red-600 dark:text-red-400" };
  }, [gpsCapturing, liveAccuracy, form.lat, form.lon, form.acc]);

  const saveBarContext = currentField
    ? `Field: ${currentField.name}`
    : currentPermission
      ? `${currentPermission.type === "rally" ? "Rally" : "Permission"}: ${currentPermission.name}`
      : locationName.trim()
        ? `Location: ${locationName.trim()}`
        : "No location set";

  // #11 — record quality indicator
  const recordQuality = useMemo(() => {
    const checks = [
      { label: "GPS", met: form.lat !== null && form.lon !== null },
      { label: "Photo", met: (media?.length ?? 0) > 0 },
      { label: "Type", met: form.objectType.trim().length > 0 },
      { label: "Details", met: !!(form.weightG || form.widthMm || form.heightMm || form.depthCm || form.decoration.trim()) },
    ];
    const score = checks.filter(c => c.met).length;
    const level = score === 4 ? "High" : score === 3 ? "Good" : score === 2 ? "Fair" : "Basic";
    const color = score >= 3
      ? "text-emerald-600 dark:text-emerald-400"
      : score === 2 ? "text-amber-600 dark:text-amber-400"
      : "text-gray-400 dark:text-gray-500";
    return { checks, score, level, color };
  }, [form.lat, form.lon, form.objectType, form.weightG, form.widthMm, form.heightMm, form.depthCm, form.decoration, media]);

  const noLocation = !locationName.trim();
  const isQuick = recordMode === "quick" && !props.quickId;
  const openSignificantFindFromForm = () => {
    props.onSignificantFind?.({
      permissionId: currentPermissionId,
      sessionId,
      linkedFindId: savedId || dbDraftId || props.quickId || null,
      lat: form.lat,
      lon: form.lon,
      gpsAccuracyM: form.acc,
      osGridRef: form.osGridRef,
      w3w: form.w3w.trim(),
      findDescription: form.objectType.trim() || form.notes.trim(),
    });
  };
  const findCoachEnabled = !hasRecordedFindBefore && !props.quickId && !savedId;
  const findCoachTips: CoachTip[] = [
    {
      title: "Quick or full",
      body: "Quick is for recording in the field. Full Record adds catalogue detail when you have time.",
      accent: "text-emerald-300",
      border: "border-emerald-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[118px] sm:bottom-auto sm:left-6 sm:right-auto sm:max-w-[320px]",
    },
    {
      title: "Location and object",
      body: "Set the permission or location, then give the find a simple title such as coin, buckle or button.",
      accent: "text-blue-300",
      border: "border-blue-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[40%] sm:bottom-auto sm:left-1/2 sm:right-auto sm:w-[320px] sm:-translate-x-1/2",
    },
    {
      title: "Photos",
      body: "Add an in-situ photo now if you can. Cleaned photos can be added later.",
      accent: "text-amber-300",
      border: "border-amber-400/35",
      button: "Add photo",
      action: () => stickyPhotoRef.current?.click(),
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:top-[52%] sm:bottom-auto sm:left-auto sm:right-6 sm:max-w-[300px]",
    },
    {
      title: "Save or finish later",
      body: "Save completes the record. Finish Later keeps a pending find you can clean up afterwards.",
      accent: "text-purple-300",
      border: "border-purple-400/35",
      position: "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 right-4 sm:bottom-[92px] sm:left-1/2 sm:right-auto sm:w-[340px] sm:-translate-x-1/2",
    },
  ];

  // Shared GPS block used in both modes
  const gpsBlock = (
    <div className="bg-gray-50/50 dark:bg-gray-900/30 p-5 rounded-2xl border-2 border-gray-100 dark:border-gray-700/50 grid gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Findspot Location</h3>
        <div className="flex gap-2 items-center">
          {/* #5 — GPS status label */}
          {gpsStatus && (
            <span className={`text-xs font-semibold ${gpsStatus.color}`}>{gpsStatus.label}</span>
          )}
          <button
            type="button"
            onClick={() => setIsPickingLocation(true)}
            className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 hover:bg-emerald-600 hover:text-white"
          >
            Map
          </button>
          {/* #5 — pulse animation while acquiring */}
          <button
            type="button"
            onClick={doGPS}
            disabled={gpsCapturing}
            className={`bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-md transition-all flex items-center gap-2 ${gpsCapturing ? "animate-pulse" : ""}`}
          >
            {gpsCapturing ? "Acquiring..." : form.lat != null ? "Update Spot" : "Capture Spot"}
          </button>
          {/* #5 — accept early once ≥5s elapsed and a live fix exists */}
          {gpsCapturing && gpsElapsed >= 5000 && liveAccuracy !== null && (
            <button
              type="button"
              onClick={() => gpsAcceptRef.current.accept?.()}
              className="bg-white dark:bg-gray-800 border border-emerald-400 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              Accept this fix
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Latitude</div>
          <input
            type="number"
            step="0.000001"
            value={form.lat ?? ""}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              const grid = (val !== null && form.lon !== null) ? toOSGridRef(val, form.lon) || form.osGridRef : form.osGridRef;
              update({ lat: val, osGridRef: grid });
            }}
            placeholder="54.123456"
            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Longitude</div>
          <input
            type="number"
            step="0.000001"
            value={form.lon ?? ""}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              const grid = (val !== null && form.lat !== null) ? toOSGridRef(form.lat, val) || form.osGridRef : form.osGridRef;
              update({ lon: val, osGridRef: grid });
            }}
            placeholder="-2.123456"
            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <div className="mb-1 text-[10px] font-bold uppercase opacity-60">OS Grid Ref</div>
          <input
            value={form.osGridRef}
            onChange={(e) => update({ osGridRef: e.target.value })}
            placeholder="e.g. TL 12345 56789"
            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[10px] font-bold uppercase opacity-60">What3Words</div>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-red-500 font-bold text-xs">///</span>
            <input
              value={form.w3w}
              onChange={(e) => update({ w3w: e.target.value })}
              placeholder="index.home.raft"
              className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 pl-7 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
        </label>
      </div>

      {form.lat != null && form.lon != null && (
        <div className="text-[10px] font-mono opacity-40 flex gap-3 items-center">
          <span>LAT: {form.lat.toFixed(6)}</span>
          <span>LON: {form.lon.toFixed(6)}</span>
          {form.acc != null && (
            <span className={`px-1.5 py-0.5 rounded font-bold opacity-100 ${
              form.acc <= 10 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" :
              form.acc <= 30 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
                               "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
            }`}>
              {form.acc <= 10 ? "GPS Good" : form.acc <= 30 ? "GPS Fair" : "GPS Poor"}: {Math.round(form.acc)}m
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid gap-6 max-w-4xl mx-auto pb-8 sm:pb-[calc(8rem+env(safe-area-inset-bottom))] scroll-pb-[calc(10rem+env(safe-area-inset-bottom))]">
      <CoachTips
        storageKey={FIND_HELPERS_SEEN_KEY}
        tips={findCoachTips}
        enabled={findCoachEnabled}
        forceShow={searchParams.get("tips") === "1"}
        mobileInline
        onDismiss={() => {
          setFindCoachActive(false);
          setFindCoachStep(0);
        }}
        onStepChange={(index) => {
          setFindCoachActive(true);
          setFindCoachStep(index);
        }}
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 px-1">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          {props.permissionId ? "Add Find" : "Record Find"}
        </h2>
        <div className="flex gap-2 sm:gap-3 flex-wrap">
          {props.onSignificantFind && (
            <button
              type="button"
              onClick={openSignificantFindFromForm}
              className="bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-4 py-2 rounded-xl font-bold shadow-sm transition-all text-sm"
            >
              Significant Find
            </button>
          )}
          <button
            onClick={() => navigate("/finds")}
            className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-xl font-bold shadow-sm transition-all text-sm"
          >
            Open All Finds
          </button>
          {savedId && sessionId && (
            <button
              onClick={() => navigate(`/session/${sessionId}`)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all flex items-center gap-2 text-sm"
            >
              Back to Session
            </button>
          )}
          {savedId && !sessionId && currentPermissionId && (
            <button
              onClick={() => navigate(`/permission/${currentPermissionId}`)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold shadow-md transition-all flex items-center gap-2 text-sm"
            >
              {currentPermission?.isClubDayMember ? "Back to Rally Day" : currentPermission?.type === "rally" ? "Back to Rally" : "Back to Permission"}
            </button>
          )}
        </div>
      </div>

      {/* #1 — Quick / Full mode toggle (hidden in quickId editing flow) */}
      {!props.quickId && (
        <div className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl ${findCoachActive && findCoachStep === 0 ? "ring-4 ring-emerald-400/25" : ""}`}>
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
            <button
              onClick={() => changeMode("quick")}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
                recordMode === "quick"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              Quick
            </button>
            <button
              onClick={() => changeMode("full")}
              className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
                recordMode === "full"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >
              Full Record
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {["Location", "Object", "Photo", "Save"].map((step, i) => (
              <span key={step} className={`px-2 py-1 rounded-lg border ${
                i === 0 && locationName.trim() ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" :
                i === 1 && form.objectType.trim() ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" :
                i === 2 && (media?.length ?? 0) > 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" :
                "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
              }`}>
                {step}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* #12 — field / session context strip */}
      {(session || currentField) && !savedId && (
        <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-xl px-4 py-2.5 flex-wrap gap-y-1">
          {session && (
            <span className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <span className="font-black text-blue-400 dark:text-blue-500 text-[10px] uppercase tracking-widest">Session</span>
              {new Date(session.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {session.isFinished && <span className="text-[10px] text-blue-400">· closed</span>}
            </span>
          )}
          {session && currentField && <span className="text-blue-200 dark:text-blue-700">·</span>}
          {currentField && (
            <span className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <span className="font-black text-blue-400 dark:text-blue-500 text-[10px] uppercase tracking-widest">Field</span>
              {currentField.name}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="border-2 border-red-200 bg-red-50 text-red-800 p-4 rounded-xl shadow-sm">{error}</div>
      )}

      {/* #14 — Draft restored badge */}
      {draftRestored && !savedId && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <span>📝</span> Draft restored from your last session.
          </span>
          <button
            onClick={() => { clearDraft(); setForm(makeInitialForm()); setUserModified(false); }}
            className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 underline shrink-0"
          >
            Discard
          </button>
        </div>
      )}

      {props.quickId && loadedFindIsPending && (
        <div className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-4 rounded-xl flex items-center gap-3">
          <span className="text-xl">🟠</span>
          <div className="text-sm">
            <span className="font-bold">Finish this quick find —</span> fill in the details below and hit Save to complete the record.
          </div>
        </div>
      )}

      {session?.isFinished && (
        <div className="border-2 border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 text-gray-600 dark:text-gray-400 p-4 rounded-xl shadow-sm flex items-center gap-3">
          <span className="text-xl">🔒</span>
          <div className="text-sm">
            <span className="font-bold">Closed Session:</span> You are adding a find to a session that was previously marked as finished.
          </div>
        </div>
      )}

      {/* #10 — Save feedback banner */}
      {savedId && !props.quickId && (
        <div className="bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="text-lg font-bold flex items-center gap-2">✓ Find recorded</div>
            <div className="text-sm opacity-80 mt-0.5">Saved to your finds.</div>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <button
              onClick={resetForm}
              className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl font-bold text-sm transition-colors"
            >
              Record Another
            </button>
            {currentPermissionId && (
              <button
                onClick={() => navigate(`/permission/${currentPermissionId}`)}
                className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl font-bold text-sm transition-colors"
              >
                {currentPermission?.isClubDayMember ? "Back to Rally Day" : currentPermission?.type === "rally" ? "Back to Rally" : "Back to Permission"}
              </button>
            )}
            <button
              onClick={() => navigate("/finds")}
              className="bg-white text-emerald-700 hover:bg-emerald-50 px-4 py-2 rounded-xl font-bold text-sm transition-colors shadow-sm"
            >
              Open Finds
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left column — form */}
        <div className={`order-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm grid gap-5 h-fit transition-opacity ${savedId && !props.quickId ? 'opacity-50 pointer-events-none' : ''} ${findCoachActive && findCoachStep === 1 ? "ring-4 ring-blue-400/25" : ""}`}>

          {/* Location — always shown */}
          <label className="block">
            <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Location Name / Permission</div>
            {props.quickId ? (
              <div className="relative">
                <select
                  value={locationName}
                  onChange={(e) => updateLocation(e.target.value)}
                  className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-500 dark:border-emerald-600 rounded-xl p-3 pr-10 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-bold appearance-none shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                >
                  <option value="">(Select Permission)</option>
                  {permissions?.map(p => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-600">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
            ) : (
              <input
                value={locationName}
                onChange={(e) => updateLocation(e.target.value)}
                placeholder="Enter permission or location name"
                className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-bold"
              />
            )}
            {noLocation && !props.permissionId && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span>⚠</span> No location set — find will be saved under "No Location" and can be updated later.
              </p>
            )}
          </label>

          {/* ── QUICK MODE ─────────────────────────────── */}
          {isQuick && (
            <>
              <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Object Type</div>
                <input
                  aria-label="Object Type / Title / Description"
                  value={form.objectType}
                  onChange={(e) => update({ objectType: e.target.value })}
                  placeholder="e.g., Coin, Buckle, Brooch"
                  className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                />
              </label>

              {gpsBlock}

              {form.acc !== null && form.acc > 15 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 flex items-center gap-3 text-sm">
                  <span className="text-amber-500 text-base shrink-0">⚠</span>
                  <span className="text-amber-800 dark:text-amber-300">
                    <span className="font-bold">Low GPS accuracy ({Math.round(form.acc)}m).</span> Move to open ground and tap <em>Update Spot</em>.
                  </span>
                </div>
              )}

              <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Notes</div>
                <textarea
                  value={form.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  rows={3}
                  placeholder="Anything interesting about this find?"
                  className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                />
              </label>
            </>
          )}

          {/* ── FULL MODE ──────────────────────────────── */}
          {!isQuick && (
            <>
              {/* Session */}
              <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300 flex justify-between">
                  <span>Session / Visit</span>
                  {props.sessionId && (
                    <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">Locked to Session</span>
                  )}
                </div>
                <select
                  value={sessionId ?? ""}
                  onChange={(e) => setSessionId(e.target.value || null)}
                  disabled={!!props.sessionId}
                  className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-medium disabled:opacity-50"
                >
                  <option value="">(No specific session)</option>
	                  {sessionOptions.map(s => (
	                    <option key={s.id} value={s.id}>
	                      {new Date(s.date).toLocaleDateString()} {s.cropType ? `(${s.cropType})` : ""}
	                    </option>
                  ))}
                </select>
              </label>

              {/* Field */}
              <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300 flex justify-between">
                  <span>Field / Area</span>
                  {session?.fieldId && (
                    <span className="text-[10px] text-emerald-600 font-black uppercase tracking-widest">Locked to Session</span>
                  )}
                </div>
                <select
                  value={fieldId ?? ""}
                  onChange={(e) => setFieldId(e.target.value || null)}
                  disabled={!!session?.fieldId}
                  className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-medium disabled:opacity-50"
                >
                  <option value="">(No specific field)</option>
                  {fields?.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>

              {/* Basic Details */}
              <CollapsibleSection title="Basic Details" open={openSections.basic} onToggle={() => toggleSection("basic")}>
                <div>
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Find Category</div>
                  <div className="flex flex-wrap gap-2">
                    {(["Coin", "Artefact", "Jewellery", "Button / Fastener", "Token / Jetton", "Other"] as const).map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => update({ findCategory: form.findCategory === cat ? "" : cat })}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                          form.findCategory === cat
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-emerald-400"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Title / Description</div>
                  <input
                    value={form.objectType}
                    onChange={(e) => update({ objectType: e.target.value })}
                    placeholder={
                      form.findCategory === "Coin" ? "e.g. Elizabeth I sixpence" :
                      form.findCategory === "Artefact" ? "e.g. Copper alloy buckle" :
                      form.findCategory === "Jewellery" ? "e.g. Silver ring" :
                      form.findCategory === "Button / Fastener" ? "e.g. Livery button" :
                      form.findCategory === "Token / Jetton" ? "e.g. Nuremberg jetton" :
                      form.findCategory === "Other" ? "e.g. Lead object" :
                      "e.g. Hammered silver penny"
                    }
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                  />
                </label>

                {(form.findCategory === "Coin" || form.findCategory === "Token / Jetton" || form.coinType || (!form.findCategory && form.objectType.toLowerCase().includes("coin"))) && (
                  <div className="grid grid-cols-1 gap-5 p-4 bg-emerald-50/30 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 animate-in slide-in-from-left-2">
                    <label className="block">
                      <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Coin Classification</div>
                      <select
                        value={form.coinType}
                        onChange={(e) => update({ coinType: e.target.value })}
                        className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                      >
                        <option value="">(Select)</option>
                        <option value="Hammered">Hammered</option>
                        <option value="Milled">Milled</option>
                        <option value="Token">Token / Jetton</option>
                        <option value="Other">Other</option>
                      </select>
                    </label>
                    <label className="block">
                      <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Denomination</div>
                      <input
                        list="denominations"
                        value={form.coinDenomination}
                        onChange={(e) => update({ coinDenomination: e.target.value })}
                        placeholder="e.g., Stater, Penny, Shilling"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                      />
                      <datalist id="denominations">
                        <option value="Stater" /><option value="Quarter Stater" /><option value="Unit" />
                        <option value="Minim" /><option value="Denarius" /><option value="Antoninianus" />
                        <option value="Sestertius" /><option value="Dupondius" /><option value="As" />
                        <option value="Follis" /><option value="Sceat" /><option value="Penny" />
                        <option value="Halfpenny" /><option value="Farthing" /><option value="Groat" />
                        <option value="Half Groat" /><option value="Threepence" /><option value="Sixpence" />
                        <option value="Shilling" /><option value="Florin" /><option value="Halfcrown" />
                        <option value="Crown" /><option value="Sovereign" /><option value="Guinea" />
                        <option value="Noble" /><option value="Ryal" /><option value="Jetton" />
                      </datalist>
                    </label>
                    <label className="block">
                      <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Spink No.</div>
                      <input
                        value={form.coinSpink}
                        onChange={(e) => update({ coinSpink: e.target.value })}
                        placeholder="e.g., 1270"
                        className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {form.period === 'Celtic' ? 'Tribe / Ruler' : form.period === 'Roman' ? 'Emperor / Ruler' : 'Ruler / Issuer'}
                      </div>
                      <input
                        value={form.ruler}
                        onChange={(e) => update({ ruler: e.target.value })}
                        placeholder={
                          form.period === 'Celtic' ? 'e.g., Iceni, Trinovantes' :
                          form.period === 'Roman' ? 'e.g., Hadrian, Constantine' :
                          'e.g., Henry II, Elizabeth I'
                        }
                        className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                      />
                    </label>
                    {(form.coinType === 'Hammered' || form.period === 'Roman') && (
                      <label className="block">
                        <div className="mb-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Mint / Mint Mark</div>
                        <input
                          value={form.mint}
                          onChange={(e) => update({ mint: e.target.value })}
                          placeholder={form.period === 'Roman' ? 'e.g., LONDINIUM, LUGDUNUM' : 'e.g., London, Canterbury'}
                          className="w-full bg-white dark:bg-gray-900 border-2 border-emerald-100 dark:border-emerald-900 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow"
                        />
                      </label>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Period</div>
                    <select value={form.period} onChange={(e) => update({ period: e.target.value as Find["period"] })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow">
                      {periods.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Material</div>
                    <select value={form.material} onChange={(e) => update({ material: e.target.value as Find["material"] })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow">
                      {(form.findCategory === 'Coin' || form.findCategory === 'Token / Jetton' ? coinMaterials : materials).map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                </div>

                {/* Date Found */}
                <div>
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Date Found</div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={form.foundDate}
                      onChange={(e) => update({ foundDate: e.target.value })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow text-sm"
                    />
                    <input
                      type="time"
                      value={form.foundTime}
                      onChange={(e) => update({ foundTime: e.target.value })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow text-sm"
                    />
                  </div>
                </div>
              </CollapsibleSection>

              {/* Measurements */}
              <CollapsibleSection title="Measurements" open={openSections.measurements} onToggle={() => toggleSection("measurements")}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Weight (g)</div>
                    <input type="number" value={form.weightG} onChange={(e) => update({ weightG: e.target.value })} placeholder="0.00"
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Width (mm)</div>
                    <input type="number" step="0.1" value={form.widthMm} onChange={(e) => update({ widthMm: e.target.value })} placeholder="0.0"
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Height (mm)</div>
                    <input type="number" step="0.1" value={form.heightMm} onChange={(e) => update({ heightMm: e.target.value })} placeholder="0.0"
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Depth (mm)</div>
                    <input type="number" step="0.1" value={form.depthMm} onChange={(e) => update({ depthMm: e.target.value })} placeholder="0.0"
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                  </label>
                </div>
                <label className="block">
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Decoration / Description</div>
                  <input value={form.decoration} onChange={(e) => update({ decoration: e.target.value })} placeholder="e.g., Zoomorphic, enamelled"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                </label>
              </CollapsibleSection>

              {/* Advanced Details */}
              <CollapsibleSection title="Advanced Details" open={openSections.advanced} onToggle={() => toggleSection("advanced")}>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Find Code</div>
                    <input value={form.findCode} onChange={(e) => update({ findCode: e.target.value })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow font-mono text-sm" />
                  </label>
                  <label className="block">
                    <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Completeness</div>
                    <select value={form.completeness} onChange={(e) => update({ completeness: e.target.value as Find["completeness"] })}
                      className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow">
                      {completenesses.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Find Context</div>
                  <input value={form.findContext} onChange={(e) => update({ findContext: e.target.value })} placeholder="e.g., Ploughsoil, field scatter"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Date / Date Range</div>
                  <input value={form.dateRange} onChange={(e) => update({ dateRange: e.target.value })} placeholder="e.g. AD 60, 1300 BC, c.1350–1400, 43–410 AD"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Storage Location</div>
                  <input value={form.storageLocation} onChange={(e) => update({ storageLocation: e.target.value })} placeholder="e.g., Box 3, Tray A"
                    className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
                </label>
              </CollapsibleSection>

              {/* Detector & Signal */}
              <CollapsibleSection title="Detector & Signal" open={openSections.detector} onToggle={() => toggleSection("detector")}>
                <label className="block">
                  <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Detector Used</div>
                  <select value={form.detector} onChange={(e) => update({ detector: e.target.value })}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none">
                    {detectors.length === 0 ? (
                      <option value="">(Set in Settings)</option>
                    ) : (
                      <>
                        <option value="">(Select Detector)</option>
                        {detectors.map(d => <option key={d} value={d}>{d}</option>)}
                      </>
                    )}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Target ID</div>
                    <input type="number" value={form.targetId} onChange={(e) => update({ targetId: e.target.value })} placeholder="e.g. 13"
                      className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none" />
                  </label>
                  <label className="block">
                    <div className="mb-1 text-[10px] font-bold uppercase opacity-60">Depth (cm)</div>
                    <input type="number" value={form.depthCm} onChange={(e) => update({ depthCm: e.target.value })} placeholder="e.g. 15"
                      className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-2 text-sm font-mono focus:ring-1 focus:ring-emerald-500 outline-none" />
                  </label>
                </div>
              </CollapsibleSection>

              {/* GPS block */}
              {gpsBlock}

              {/* Notes */}
              <label className="block">
                <div className="mb-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">Notes</div>
                <textarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} rows={3}
                  className="w-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 rounded-xl p-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-shadow" />
              </label>

              {form.acc !== null && form.acc > 15 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 flex items-center gap-3 text-sm">
                  <span className="text-amber-500 text-base shrink-0">⚠</span>
                  <span className="text-amber-800 dark:text-amber-300">
                    <span className="font-bold">Low GPS accuracy ({Math.round(form.acc)}m).</span> Move to open ground and tap <em>Update Spot</em> for a better fix before saving.
                  </span>
                </div>
              )}
            </>
          )}

          {/* #11 — record quality indicator */}
          {!savedId && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-gray-500 dark:text-gray-400 font-semibold">Record quality</span>
              <div className="flex items-center gap-2">
                {recordQuality.checks.map(c => (
                  <span key={c.label} className={`text-xs font-bold flex items-center gap-0.5 ${c.met ? "text-emerald-500 dark:text-emerald-400" : "text-gray-400 dark:text-gray-500"}`}>
                    {c.met ? "✓" : "·"} {c.label}
                  </span>
                ))}
                <span className={`text-xs font-black ml-1 ${recordQuality.color}`}>{recordQuality.level}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right column — Photos */}
        <div className={`order-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col gap-4 h-fit lg:sticky lg:top-4 ${findCoachActive && findCoachStep === 2 ? "ring-4 ring-amber-300/30" : ""}`}>
          <div className="flex flex-col gap-4 mb-2">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 m-0">Photos</h2>

            {/* #4 — photo buttons always active; auto-saves find if not yet saved */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-100">
                <span>In Situ Photo</span>
                <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "in-situ")} className="hidden" />
              </label>
              <label className="px-3 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100">
                <span>Cleaned Photo</span>
                <input type="file" accept="image/*" capture="environment" onChange={(e) => addPhotos(e.target.files, "cleaned")} className="hidden" />
              </label>
            </div>

            <div className="flex gap-2">
              <label className="flex-1 px-3 py-2 rounded-lg font-bold text-xs shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-gray-700 dark:text-gray-200">
                Upload Files
                <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} className="hidden" />
              </label>
            </div>
          </div>

          {(!media || media.length === 0) && (
            <div className="text-center py-6 text-sm border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50/60 dark:bg-gray-900/30">
              <p className="font-bold text-gray-500 dark:text-gray-400">No photos yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add an in situ photo first, then a cleaned photo when available.</p>
            </div>
          )}

          {media && media.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {media.map(m => <PhotoThumb key={m.id} mediaId={m.id} filename={m.filename} />)}
            </div>
          )}
        </div>
      </div>

      {milestoneMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-bold pointer-events-none whitespace-nowrap">
          {milestoneMsg}
        </div>
      )}

      {/* #2 — Sticky bottom save bar */}
      <div className={`relative sm:fixed sm:bottom-0 sm:left-0 sm:right-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border border-gray-200 dark:border-gray-700 sm:border-x-0 sm:border-b-0 rounded-2xl sm:rounded-none px-3 sm:px-4 pt-2 sm:pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-wrap sm:flex-nowrap gap-2 sm:gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] ${findCoachActive && findCoachStep === 3 ? "ring-4 ring-purple-300/30" : ""}`}>
        <div className="basis-full min-w-0 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
          <span className="truncate">{saveBarContext}</span>
          {gpsStatus && <span className={`shrink-0 ${gpsStatus.color}`}>{gpsStatus.label}</span>}
        </div>
        {/* Quick photo shortcut — always active (#4) */}
        <label className="flex items-center justify-center gap-2 px-3 sm:px-4 py-3 rounded-xl font-bold text-sm transition-all shrink-0 cursor-pointer bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100">
          <span className="hidden sm:inline">Add Photo</span><span className="sm:hidden">Photo</span>
          <input
            ref={stickyPhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => addPhotos(e.target.files, "in-situ")}
            className="hidden"
          />
        </label>

        {props.onSignificantFind && (
          <button
            type="button"
            onClick={openSignificantFindFromForm}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-3 rounded-xl font-bold text-sm transition-all shrink-0 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            <span className="hidden sm:inline">Significant Find</span>
            <span className="sm:hidden">Significant</span>
          </button>
        )}

        {gpsCapturing && !savedId && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold absolute -top-6 left-0 right-0 text-center bg-amber-50 dark:bg-amber-900/30 py-1">
            GPS still locating. You can save without a location or wait.
          </p>
        )}

        {/* #1 — "Finish Later" only in Quick mode, only when unsaved */}
        {isQuick && !savedId && (
          <button
            onClick={saveAsPending}
            disabled={saving}
            className="px-3 sm:px-4 py-3 rounded-xl font-bold text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all shrink-0 disabled:opacity-50"
          >
            Finish Later
          </button>
        )}

        {/* Primary save button */}
        <button
          onClick={saveFind}
          disabled={saving}
          className={`min-w-[9rem] flex-1 px-4 sm:px-6 py-3 rounded-xl font-bold text-base shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:transform-none ${
            savedId ? "bg-green-600 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"
          }`}
        >
          {saving ? "Saving..." : savedId ? "Saved" : "Save Find"}
        </button>
      </div>

      {isPickingLocation && (
        <React.Suspense fallback={<div className="fixed inset-0 z-[120] bg-black/40" />}>
          <LocationPickerModal
            initialLat={form.lat}
            initialLon={form.lon}
            onClose={() => setIsPickingLocation(false)}
            onSelect={(pickedLat, pickedLon) => {
              const grid = toOSGridRef(pickedLat, pickedLon);
              update({ lat: pickedLat, lon: pickedLon, acc: null, osGridRef: grid || "" });
              setIsPickingLocation(false);
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}
