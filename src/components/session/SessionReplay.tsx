import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { sessionStartedAt } from '../../services/session/activeSessionContext';
import { buildSessionReplay, type SessionReplayData, type SessionReplayMarkerKind } from '../../services/session/sessionReplay';

const REPLAY_DURATION_MS = 30_000;
const MARKER_COLOURS: Record<SessionReplayMarkerKind, string> = {
  find: '#10b981',
  signal: '#38bdf8',
  observation: '#f59e0b',
  saved_point: '#a78bfa',
};

function formatReplayTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function projection(data: SessionReplayData) {
  const locations = [
    ...data.trailSegments.flat(),
    ...data.markers,
  ];
  if (locations.length === 0) return null;
  const lats = locations.map(point => point.lat);
  const lons = locations.map(point => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.00005);
  const lonSpan = Math.max(maxLon - minLon, 0.00005);
  return (point: { lat: number; lon: number }) => ({
    x: 5 + ((point.lon - minLon) / lonSpan) * 90,
    y: 59 - ((point.lat - minLat) / latSpan) * 54,
  });
}

export function SessionReplay({ sessionId }: { sessionId: string }) {
  const records = useLiveQuery(async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return null;
    const [tracks, finds, signals, observations, savedPoints] = await Promise.all([
      db.tracks.where('sessionId').equals(sessionId).toArray(),
      db.finds.where('sessionId').equals(sessionId).toArray(),
      db.undugSignals.where('sessionId').equals(sessionId).toArray(),
      db.surfaceObservations.where('sessionId').equals(sessionId).toArray(),
      db.savedPoints.where('projectId').equals(session.projectId).toArray(),
    ]);
    const parsedEnd = session.endTime ? Date.parse(session.endTime) : null;
    return buildSessionReplay({
      sessionId,
      sessionStartedAt: sessionStartedAt(session),
      sessionEndedAt: parsedEnd != null && Number.isFinite(parsedEnd) ? parsedEnd : null,
      tracks,
      finds,
      signals,
      observations,
      savedPoints,
    });
  }, [sessionId]);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setProgress(current => Math.min(1, current + elapsed / REPLAY_DURATION_MS));
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (playing && progress >= 1) setPlaying(false);
  }, [playing, progress]);

  const project = useMemo(() => records ? projection(records) : null, [records]);
  if (records === undefined) return <p className="text-xs text-gray-500">Loading replay…</p>;
  if (!records || !project) return <p className="text-xs text-gray-500">No located session activity is available to replay.</p>;

  const cursorTime = records.startedAt + progress * (records.endedAt - records.startedAt);
  const visibleMarkers = records.markers.filter(marker => marker.timestamp <= cursorTime);

  return (
    <div className="flex flex-col gap-3" aria-label="Read-only session replay">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-slate-950 dark:border-gray-700">
        <svg viewBox="0 0 100 64" className="h-56 w-full" role="img" aria-label="Recorded trail and session events appearing in time order">
          <rect width="100" height="64" fill="#07131b" />
          {records.trailSegments.map((segment, segmentIndex) => {
            const points = segment.filter(point => point.timestamp <= cursorTime).map(project);
            if (points.length < 2) return null;
            return <polyline key={segmentIndex} points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2dd4bf" strokeWidth="0.75" strokeLinecap="round" strokeLinejoin="round" />;
          })}
          {visibleMarkers.map(marker => {
            const point = project(marker);
            return <circle key={`${marker.kind}-${marker.id}`} cx={point.x} cy={point.y} r="1.5" fill={MARKER_COLOURS[marker.kind]} stroke="#fff" strokeWidth="0.45"><title>{marker.label}</title></circle>;
          })}
        </svg>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (progress >= 1) setProgress(0);
            setPlaying(current => !current);
          }}
          className="min-h-11 rounded-xl bg-teal-600 px-4 text-xs font-black uppercase tracking-wider text-white hover:bg-teal-500"
        >
          {playing ? 'Pause' : progress >= 1 ? 'Replay' : 'Play'}
        </button>
        <input
          aria-label="Replay position"
          type="range"
          min="0"
          max="1000"
          value={Math.round(progress * 1000)}
          onChange={event => { setPlaying(false); setProgress(Number(event.target.value) / 1000); }}
          className="min-w-0 flex-1 accent-teal-500"
        />
        <span className="w-14 text-right text-xs font-bold tabular-nums text-gray-500">{formatReplayTime(cursorTime)}</span>
      </div>
      <p className="text-xs leading-relaxed text-gray-500">
        Read-only playback of recorded trail points and timestamped finds, signals, observations and saved points. Gaps stay gaps.
      </p>
    </div>
  );
}
