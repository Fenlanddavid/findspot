import React from "react";
import { useNavigate } from "react-router-dom";
import { WorkflowState } from "../../../types/significantFind";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../../db";
import { Find } from "../../../db";
import { getFLOForCounty } from "../../../services/flo";
import { getParishAndCounty } from "../../../services/pas";
import { getSetting } from "../../../services/data";
import { buildScatterEmail, buildMailtoLink } from "../../../utils/floEmail";

type Props = {
  workflowState: WorkflowState;
  updateState: (patch: Partial<WorkflowState>) => void;
  onNext: () => void;
  onClose: () => void;
};

export default function ScatterCompleteScreen({ workflowState, updateState, onClose }: Props) {
  const navigate = useNavigate();
  const creatingRef = React.useRef(false);

  const scatterFinds = useLiveQuery<Find[]>(
    () => workflowState.scatterId
      ? db.finds.where("scatterId").equals(workflowState.scatterId).toArray()
      : Promise.resolve([] as Find[]),
    [workflowState.scatterId]
  );

  const [copied, setCopied] = React.useState(false);
  const [voiceNote, setVoiceNote] = React.useState("");
  const [recordTitle, setRecordTitle] = React.useState(workflowState.findDescription ?? "");
  const [county, setCounty] = React.useState("");
  const [collectorName, setCollectorName] = React.useState("");
  const [createdAt, setCreatedAt] = React.useState<string | undefined>(undefined);

  const count = scatterFinds?.length ?? workflowState.scatterFindIds.length;

  React.useEffect(() => {
    async function init() {
      const firstFind = workflowState.scatterId
        ? await db.finds.where("scatterId").equals(workflowState.scatterId).first()
        : undefined;

      // Create the significantFinds record if path 2 hasn't made one yet
      if (!workflowState.significantFindId && workflowState.scatterId && !creatingRef.current) {
        creatingRef.current = true;
        const now = new Date().toISOString();
        const { v4: uuid } = await import("uuid");
        const newId = uuid();
        // Use first scatter find's location if workflow has no GPS yet
        const lat = workflowState.lat ?? firstFind?.lat ?? null;
        const lon = workflowState.lon ?? firstFind?.lon ?? null;
        const osGridRef = workflowState.osGridRef || firstFind?.osGridRef || "";
        await db.significantFinds.add({
          id: newId,
          projectId: workflowState.projectId,
          permissionId: workflowState.permissionId ?? "",
          sessionId: workflowState.sessionId,
          path: "map_scatter",
          status: "in_progress",
          jurisdiction: workflowState.jurisdiction,
          lat,
          lon,
          gpsAccuracyM: workflowState.gpsAccuracyM,
          osGridRef,
          w3w: workflowState.w3w,
          preExcavationNotes: workflowState.preExcavationNotes,
          soilObservations: workflowState.soilObservations,
          secureCoverNotes: workflowState.secureCoverNotes,
          groundSurfacePhotoCaptured: workflowState.groundSurfacePhotoCaptured,
          findDescription: workflowState.findDescription,
          scatterId: workflowState.scatterId,
          scatterFindIds: workflowState.scatterFindIds,
          linkedFindId: null,
          treasureActResult: null,
          treasureActDraft: "",
          landownerSummary: "",
          createdAt: now,
          updatedAt: now,
        });
        updateState({ significantFindId: newId });
        setCreatedAt(now);
      } else if (workflowState.significantFindId) {
        db.significantFinds.get(workflowState.significantFindId).then(sf => {
          if (sf?.createdAt) setCreatedAt(sf.createdAt);
        });
      }

      const reverseLat = workflowState.lat ?? firstFind?.lat ?? null;
      const reverseLon = workflowState.lon ?? firstFind?.lon ?? null;
      if (reverseLat != null && reverseLon != null) {
        getParishAndCounty(reverseLat, reverseLon)
          .then(({ county: c }) => setCounty(c))
          .catch(() => {});
      }
      getSetting("detectorist", "").then(setCollectorName);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const floEntry = getFLOForCounty(county);

  // Compute bounding box span
  const areaDesc = React.useMemo(() => {
    const finds = scatterFinds?.filter(f => f.lat != null && f.lon != null) ?? [];
    if (finds.length < 2) return null;
    const lats = finds.map(f => f.lat!);
    const lons = finds.map(f => f.lon!);
    const latSpan = (Math.max(...lats) - Math.min(...lats)) * 111320;
    const lonSpan = (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(lats[0] * Math.PI / 180);
    const maxSpan = Math.max(latSpan, lonSpan);
    if (maxSpan < 5) return "within 5 metres";
    if (maxSpan < 100) return `${Math.round(maxSpan)} metres`;
    return `${(maxSpan / 1000).toFixed(2)} km`;
  }, [scatterFinds]);

  const floEmailHref = React.useMemo(() => {
    if (!floEntry || !scatterFinds) return null;
    const { subject, body } = buildScatterEmail(workflowState, scatterFinds, collectorName, floEntry, createdAt);
    return buildMailtoLink(floEntry.email, subject, body);
  }, [floEntry, scatterFinds, workflowState, collectorName, createdAt]);

  async function copyScatterSummary() {
    const lines = [
      `SCATTER FIND SUMMARY`,
      `Date: ${new Date().toLocaleDateString("en-GB")}`,
      `Finds recorded: ${count}`,
      areaDesc ? `Spread: ${areaDesc}` : "",
      "",
      ...(scatterFinds ?? []).map((f, i) =>
        `${i + 1}. ${f.objectType} — ${f.period} — ${f.osGridRef || `${f.lat?.toFixed(5)}, ${f.lon?.toFixed(5)}`}${f.depthCm ? ` — ${f.depthCm}cm deep` : ""}`
      ),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function saveVoiceNote() {
    if (!voiceNote.trim() || !workflowState.significantFindId) return;
    await db.significantFinds.update(workflowState.significantFindId, {
      firstPersonAccount: voiceNote,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleDone() {
    onClose();
    navigate("/finds-box?tab=significant");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="text-4xl mb-2">✅</div>
        <h3 className="text-xl font-black text-gray-900 dark:text-gray-100">Scatter mapped</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {count} find{count !== 1 ? "s" : ""} recorded{areaDesc ? ` across ${areaDesc}` : ""}
        </p>
      </div>

      {/* Record title */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Record title</label>
        <input
          type="text"
          value={recordTitle}
          onChange={e => setRecordTitle(e.target.value)}
          onBlur={async () => {
            const title = recordTitle.trim();
            updateState({ findDescription: title });
            if (workflowState.significantFindId) {
              await db.significantFinds.update(workflowState.significantFindId, {
                findDescription: title,
                updatedAt: new Date().toISOString(),
              });
            }
          }}
          placeholder="e.g. Roman coins — scattered hoard"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-400"
        />
      </div>

      {/* Find list */}
      {scatterFinds && scatterFinds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {scatterFinds.map((f, i) => (
            <div key={f.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2">
              <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{f.objectType}</p>
                <p className="text-xs text-gray-500">{f.period}{f.depthCm ? ` · ${f.depthCm}cm` : ""}{f.osGridRef ? ` · ${f.osGridRef}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voice / text note */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Describe the find area <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          value={voiceNote}
          onChange={e => setVoiceNote(e.target.value)}
          onBlur={saveVoiceNote}
          rows={3}
          placeholder="Size of the area, shape of the scatter, any features nearby — field edge, ditch line, change in soil colour…"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 resize-none placeholder:text-gray-400"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          onClick={copyScatterSummary}
          className="flex items-center justify-center gap-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
        >
          {copied ? "✓ Copied" : "Copy scatter summary"}
        </button>

        {floEmailHref ? (
          <a
            href={floEmailHref}
            className="flex items-center justify-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 hover:border-amber-500 text-amber-700 dark:text-amber-300 py-3 rounded-xl text-sm font-bold transition-all"
          >
            ✉️ Email {floEntry!.name} — full record
          </a>
        ) : (
          <a
            href="https://finds.org.uk/contacts"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-amber-400 text-gray-700 dark:text-gray-300 py-3 rounded-xl text-sm font-bold transition-all"
          >
            Find your local FLO →
          </a>
        )}

        <a
          href="tel:08000025808"
          className="flex items-center justify-center gap-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-amber-400 text-gray-700 dark:text-gray-300 py-3 rounded-xl text-sm font-bold transition-all"
        >
          NCMD: 0800 002 5808
        </a>
      </div>

      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Record this scatter with your local FLO — they'll want to see the map.
      </p>

      <button
        onClick={handleDone}
        className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-all active:scale-95 hover:opacity-90"
      >
        Done — view record
      </button>
    </div>
  );
}
