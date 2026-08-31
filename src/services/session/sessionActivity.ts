import type { Find, SavedPoint, SurfaceObservation, UndugSignal } from '../../db';

export type SessionActivityKind = 'find' | 'signal' | 'observation' | 'point';

export type SessionActivityItem = {
  id: string;
  kind: SessionActivityKind;
  title: string;
  detail: string;
  timestamp: number;
};

function parsed(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function recentSessionActivity(input: {
  finds: readonly Find[];
  signals: readonly UndugSignal[];
  observations: readonly SurfaceObservation[];
  savedPoints: readonly SavedPoint[];
}, limit = 3): SessionActivityItem[] {
  return [
    ...input.finds.map(find => ({
      id: find.id,
      kind: 'find' as const,
      title: find.isPending ? 'Find saved for later' : 'Find recorded',
      detail: find.objectType || 'Find',
      timestamp: parsed(find.foundAt ?? find.createdAt),
    })),
    ...input.signals.map(signal => ({
      id: signal.id,
      kind: 'signal' as const,
      title: 'Signal marked',
      detail: signal.vdi ? `VDI ${signal.vdi}` : 'Undug signal',
      timestamp: parsed(signal.createdAt),
    })),
    ...input.observations.filter(item => !item.retiredAt).map(observation => ({
      id: observation.id,
      kind: 'observation' as const,
      title: observation.observationKind === 'iron_patch' ? 'Iron / junk patch' : 'Surface observation',
      detail: observation.observationKind === 'iron_patch'
        ? (observation.extent?.replaceAll('_', ' ') ?? 'Approximate patch')
        : observation.material.replaceAll('_', ' '),
      timestamp: parsed(observation.observedAt ?? observation.createdAt),
    })),
    ...input.savedPoints.map(point => ({
      id: point.id,
      kind: 'point' as const,
      title: 'Location marked',
      detail: point.label,
      timestamp: parsed(point.createdAt),
    })),
  ].sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id)).slice(0, limit);
}
