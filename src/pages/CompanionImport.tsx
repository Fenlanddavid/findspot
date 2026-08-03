import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { v4 as uuid } from 'uuid';
import type { Session } from '../db';
import {
  importCompanionRecording,
  inspectCompanionRecording,
  type CompanionImportPreview,
  type CompanionImportResult,
} from '../services/companionImport';
import { takePendingCompanionShare } from '../services/companionShare';
import {
  companionRecordingHref,
  COMPANION_DOWNLOAD_URL,
  isAndroidUserAgent,
} from '../services/companionLaunch';
import { pagePersistence } from '../services/pagePersistence';
import { setDurableSetting } from '../services/clientStorage';
import { finishSessionRecord } from '../services/sessionMutations';
import { prepareSessionSearchedAreas } from '../services/sessionCoverageCommands';
import { reportNonFatal } from '../services/diagLog';

type Props = { projectId: string };

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'Interrupted recording';
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function sessionLabel(session: Session, permissionName: string | undefined): string {
  const status = session.isFinished ? 'finished' : 'active';
  return `${permissionName ?? 'Permission'} · ${new Date(session.date).toLocaleString()} · ${status}`;
}

export default function CompanionImport({ projectId }: Props) {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [preview, setPreview] = useState<CompanionImportPreview | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState(searchParams.get('session') ?? '');
  const [creatingSession, setCreatingSession] = useState(false);
  const [newPermissionId, setNewPermissionId] = useState('');
  const [newFieldId, setNewFieldId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanionImportResult | null>(null);
  const [didFinishSession, setDidFinishSession] = useState(false);
  const isAndroid = useMemo(() => isAndroidUserAgent(), []);
  const companionMissing = searchParams.get('companion') === 'missing';
  const receivedCompanionShare = searchParams.get('shared') === '1';
  const finishAfterImport = receivedCompanionShare && searchParams.get('finish') === '1';
  const companionHref = useMemo(
    () => companionRecordingHref(searchParams.get('session') ?? undefined),
    [searchParams],
  );

  const sessions = useLiveQuery(
    async () => (await pagePersistence.sessions.where('projectId').equals(projectId).toArray())
      .sort((left, right) => Date.parse(right.date) - Date.parse(left.date)),
    [projectId],
  ) ?? [];
  const permissions = useLiveQuery(
    () => pagePersistence.permissions.where('projectId').equals(projectId).toArray(),
    [projectId],
  ) ?? [];
  const fields = useLiveQuery(
    () => pagePersistence.fields.where('projectId').equals(projectId).toArray(),
    [projectId],
  ) ?? [];
  const permissionNames = useMemo(
    () => new Map(permissions.map(permission => [permission.id, permission.name])),
    [permissions],
  );
  const availableFields = fields.filter(field => field.permissionId === newPermissionId);

  useEffect(() => {
    if (!companionMissing && !receivedCompanionShare) return;
    void setDurableSetting('fs_companion_active_session', '');
  }, [companionMissing, receivedCompanionShare]);

  useEffect(() => {
    if (selectedSessionId || sessions.length === 0) return;
    const active = sessions.find(session => !session.isFinished);
    if (active) {
      setSelectedSessionId(active.id);
      return;
    }
    if (preview) {
      const nearest = [...sessions].sort((left, right) => (
        Math.abs(Date.parse(left.date) - preview.recording.startedAtUtc)
        - Math.abs(Date.parse(right.date) - preview.recording.startedAtUtc)
      ))[0];
      if (nearest) setSelectedSessionId(nearest.id);
    }
  }, [preview, selectedSessionId, sessions]);

  useEffect(() => {
    if (!receivedCompanionShare) return;
    void takePendingCompanionShare()
      .then(file => {
        if (!file) throw new Error('The shared recording is no longer available. Share it again from Companion.');
        return loadFile(file);
      })
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  // The share cache is intentionally consumed only once on initial navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const inspected = await inspectCompanionRecording(file);
      setPreview(inspected);
      const automaticSessionId = receivedCompanionShare
        ? searchParams.get('session') ?? ''
        : '';
      if (automaticSessionId) {
        const target = await pagePersistence.sessions.get(automaticSessionId);
        if (!target) throw new Error('The FindSpot session for this recording could not be found.');
        const imported = await completeImport(
          inspected,
          automaticSessionId,
          undefined,
          finishAfterImport,
        );
        nav(`/session/${imported.sessionId}`, { replace: true });
      }
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function completeImport(
    inspected: CompanionImportPreview,
    sessionId: string,
    newSession?: Session,
    finishSession = false,
  ) {
    const imported = await importCompanionRecording(inspected, sessionId, newSession);
    if (finishSession) {
      const stoppedAt = inspected.recording.stoppedAtUtc ?? Date.now();
      await finishSessionRecord(imported.sessionId, new Date(stoppedAt).toISOString());
      try {
        await prepareSessionSearchedAreas(imported.sessionId);
      } catch (error) {
        // The session and raw imported trail remain safe; coverage can regenerate later.
        reportNonFatal('companion-import', 'Finished session coverage preparation failed', error);
      }
      setDidFinishSession(true);
    }
    setResult(imported);
    setSelectedSessionId(imported.sessionId);
    return imported;
  }

  function buildAssociatedSession(): Session {
    const permission = permissions.find(candidate => candidate.id === newPermissionId);
    if (!permission) throw new Error('Choose a permission for the new session.');
    const field = newFieldId ? fields.find(candidate => candidate.id === newFieldId) : undefined;
    if (field && field.permissionId !== permission.id) throw new Error('The selected field does not belong to that permission.');
    if (!preview) throw new Error('Choose a Companion recording first.');
    const firstPoint = preview.recording.segments.flatMap(segment => segment.observations)[0];
    const now = new Date().toISOString();
    const session: Session = {
      id: uuid(),
      projectId,
      permissionId: permission.id,
      fieldId: field?.id ?? null,
      date: new Date(preview.recording.startedAtUtc).toISOString(),
      lat: firstPoint?.latitude ?? null,
      lon: firstPoint?.longitude ?? null,
      gpsAccuracyM: firstPoint?.horizontalAccuracyM ?? null,
      landUse: '',
      cropType: '',
      isStubble: false,
      notes: 'Session created from a FindSpot Companion recording.',
      isFinished: true,
      startTime: new Date(preview.recording.startedAtUtc).toISOString(),
      endTime: preview.recording.stoppedAtUtc === null
        ? now
        : new Date(preview.recording.stoppedAtUtc).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    return session;
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const newSession = creatingSession ? buildAssociatedSession() : undefined;
      const sessionId = newSession?.id ?? selectedSessionId;
      if (!sessionId) throw new Error('Choose the session that this recording belongs to.');
      await completeImport(preview, sessionId, newSession);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl pb-24">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Native recording</p>
          <h1 className="text-2xl font-black text-gray-950 dark:text-white">Import Companion trail</h1>
        </div>
        <Link to="/" className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold dark:border-gray-700">Close</Link>
      </div>

      {companionMissing && (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100" role="status">
          <h2 className="font-black">FindSpot Companion is not installed</h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-200/80">
            Nothing has changed in this session and no data has been lost. The Android beta is invite-only. Message us via Facebook with the Google account you use for the Play Store, and we’ll add you to the test. Do not disable your phone's security protections to install an APK.
          </p>
          {COMPANION_DOWNLOAD_URL ? (
            <a
              href={COMPANION_DOWNLOAD_URL}
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Google Play test
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="mt-3 inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-xl bg-amber-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
            >
              Google Play beta coming soon
            </button>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
        <h2 className="font-black text-emerald-950 dark:text-emerald-100">Lossless, local import</h2>
        <p className="mt-1 text-sm text-emerald-900/75 dark:text-emerald-200/75">
          FindSpot validates the complete recording before writing anything. Each pause remains a separate trail segment.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {isAndroid ? (
            <a
              href={companionHref}
              className="rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white"
            >
              Open Companion
            </a>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-xl bg-gray-200 px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-500 dark:bg-gray-700 dark:text-gray-400">
              Companion · Android only
            </span>
          )}
          <label className="cursor-pointer rounded-xl border border-emerald-300 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-emerald-800 dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-300">
            {busy && !preview ? 'Validating…' : 'Choose recording'}
            <input
              type="file"
              accept=".json,.findspot.json,application/json,application/vnd.findspot.companion+json"
              className="hidden"
              disabled={busy}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </section>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200" role="alert">
          {error}
        </div>
      )}

      {preview && !result && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><span className="block text-[9px] font-black uppercase text-gray-400">Started</span>{preview.startedAt.toLocaleString()}</div>
            <div><span className="block text-[9px] font-black uppercase text-gray-400">Duration</span>{formatDuration(preview.durationMs)}</div>
            <div><span className="block text-[9px] font-black uppercase text-gray-400">Segments</span>{preview.segmentCount}</div>
            <div><span className="block text-[9px] font-black uppercase text-gray-400">Points</span>{preview.pointCount.toLocaleString()}</div>
          </div>

          <fieldset className="mt-5">
            <legend className="text-xs font-black uppercase tracking-widest text-gray-500">Attach to a session</legend>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="radio" checked={!creatingSession} onChange={() => setCreatingSession(false)} />
              <span className="flex-1">
                <span className="font-bold">Existing session</span>
                <select
                  value={selectedSessionId}
                  onChange={event => setSelectedSessionId(event.target.value)}
                  disabled={creatingSession}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="">Choose session…</option>
                  {sessions.map(session => (
                    <option key={session.id} value={session.id}>
                      {sessionLabel(session, permissionNames.get(session.permissionId))}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="radio" checked={creatingSession} onChange={() => setCreatingSession(true)} />
              <span className="flex-1">
                <span className="font-bold">Create a finished session</span>
                {creatingSession && (
                  <span className="mt-2 grid gap-2">
                    <select value={newPermissionId} onChange={event => { setNewPermissionId(event.target.value); setNewFieldId(''); }} className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                      <option value="">Choose permission…</option>
                      {permissions.map(permission => <option key={permission.id} value={permission.id}>{permission.name}</option>)}
                    </select>
                    <select value={newFieldId} onChange={event => setNewFieldId(event.target.value)} disabled={!newPermissionId} className="rounded-xl border border-gray-200 bg-white px-3 py-3 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900">
                      <option value="">No mapped field</option>
                      {availableFields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
                    </select>
                  </span>
                )}
              </span>
            </label>
          </fieldset>

          <button
            type="button"
            onClick={() => void confirmImport()}
            disabled={busy || (!creatingSession && !selectedSessionId) || (creatingSession && !newPermissionId)}
            className="mt-5 w-full rounded-xl bg-emerald-600 py-3 text-sm font-black uppercase tracking-widest text-white disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Confirm and import'}
          </button>
        </section>
      )}

      {result && (
        <section className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-950/20" role="status">
          <h2 className="font-black text-emerald-950 dark:text-emerald-100">
            {result.alreadyImported ? 'Already safely imported' : 'Recording imported'}
          </h2>
          <p className="mt-1 text-sm text-emerald-900/75 dark:text-emerald-200/75">
            {result.trackIds.length} segment{result.trackIds.length === 1 ? '' : 's'} preserved.
            {didFinishSession && ' The session has been finished.'}
            {result.derivationStatus === 'failed' && ' Coverage regeneration will retry when FindSpot next opens.'}
          </p>
          <button type="button" onClick={() => nav(`/session/${selectedSessionId}`)} className="mt-4 rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">
            Open session
          </button>
        </section>
      )}
    </main>
  );
}
