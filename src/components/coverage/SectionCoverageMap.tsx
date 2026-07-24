import React, { useMemo } from 'react';
import type {
  PermissionSection,
  SessionCoverageObservation,
} from '../../db';
import { currentSectionGeometry } from '../../shared/coverageRecords';

type Coordinate = [number, number];

export type SectionEvidenceSummary = {
  reported: boolean;
  tracked: boolean;
  findVisited: boolean;
  count: number;
  latestObservedAt: number | null;
};

function geometryRings(section: PermissionSection): Coordinate[][] {
  const current = currentSectionGeometry(section);
  if (!current) return [];
  if (current.geometry.type === 'Polygon') {
    return current.geometry.coordinates.map(ring =>
      ring.map(point => [point[0], point[1]] as Coordinate)
    );
  }
  return current.geometry.coordinates.flatMap(polygon =>
    polygon.map(ring => ring.map(point => [point[0], point[1]] as Coordinate))
  );
}

function evidenceBySection(
  observations: SessionCoverageObservation[],
): Map<string, SectionEvidenceSummary> {
  const result = new Map<string, SectionEvidenceSummary>();
  for (const observation of observations) {
    const previous = result.get(observation.sectionId) ?? {
      reported: false,
      tracked: false,
      findVisited: false,
      count: 0,
      latestObservedAt: null,
    };
    result.set(observation.sectionId, {
      reported: previous.reported || observation.evidence === 'reported',
      tracked: previous.tracked || observation.evidence === 'tracked',
      findVisited: previous.findVisited || observation.evidence === 'find-visited',
      count: previous.count + 1,
      latestObservedAt: Math.max(
        previous.latestObservedAt ?? Number.NEGATIVE_INFINITY,
        observation.observedAt,
      ),
    });
  }
  return result;
}

function fillForEvidence(
  evidence: SectionEvidenceSummary,
  selected: boolean,
): { fill: string; opacity: number } {
  if (selected || evidence.reported) return { fill: '#10b981', opacity: 0.68 };
  if (evidence.tracked) return { fill: '#0ea5e9', opacity: 0.62 };
  if (evidence.findVisited) return { fill: '#f59e0b', opacity: 0.28 };
  return { fill: '#e5e7eb', opacity: 0.58 };
}

export function summarizeSectionEvidence(
  observations: SessionCoverageObservation[],
): Map<string, SectionEvidenceSummary> {
  return evidenceBySection(observations);
}

export function SectionCoverageMap(props: {
  sections: PermissionSection[];
  observations: SessionCoverageObservation[];
  selectedReported?: ReadonlySet<string>;
  interactive?: boolean;
  onToggle?: (sectionId: string) => void;
  onInspect?: (sectionId: string) => void;
  selectedSectionId?: string | null;
}) {
  const rendered = useMemo(() => props.sections.map(section => ({
    section,
    rings: geometryRings(section),
  })).filter(item => item.rings.length > 0), [props.sections]);
  const evidence = useMemo(
    () => evidenceBySection(props.observations),
    [props.observations],
  );
  const allPoints = rendered.flatMap(item => item.rings.flat());
  if (allPoints.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-xs font-semibold text-gray-400 dark:border-gray-700 dark:bg-gray-900/40">
        Add a field boundary to use section coverage.
      </div>
    );
  }

  const west = Math.min(...allPoints.map(point => point[0]));
  const east = Math.max(...allPoints.map(point => point[0]));
  const south = Math.min(...allPoints.map(point => point[1]));
  const north = Math.max(...allPoints.map(point => point[1]));
  const width = Math.max(east - west, 0.000001);
  const height = Math.max(north - south, 0.000001);
  const project = ([lon, lat]: Coordinate): Coordinate => [
    4 + ((lon - west) / width) * 92,
    4 + ((north - lat) / height) * 64,
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-slate-100 dark:border-gray-700 dark:bg-slate-950">
      <svg
        viewBox="0 0 100 72"
        className="block h-auto min-h-52 w-full"
        aria-label="Permission sections"
        role="group"
      >
        <rect width="100" height="72" fill="currentColor" className="text-slate-100 dark:text-slate-950" />
        {rendered.map(({ section, rings }) => {
          const state = evidence.get(section.id) ?? {
            reported: false,
            tracked: false,
            findVisited: false,
            count: 0,
            latestObservedAt: null,
          };
          const selected = props.selectedReported?.has(section.id) ?? false;
          const colours = fillForEvidence(state, selected);
          const path = rings.map(ring =>
            ring.map((point, index) => {
              const [x, y] = project(point);
              return `${index === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`;
            }).join(' ') + ' Z'
          ).join(' ');
          const click = () => {
            if (props.interactive) props.onToggle?.(section.id);
            else props.onInspect?.(section.id);
          };
          return (
            <path
              key={section.id}
              d={path}
              fill={colours.fill}
              fillOpacity={colours.opacity}
              fillRule="evenodd"
              stroke={props.selectedSectionId === section.id ? '#111827' : '#ffffff'}
              strokeWidth={props.selectedSectionId === section.id ? 0.9 : 0.45}
              vectorEffect="non-scaling-stroke"
              className={props.interactive || props.onInspect ? 'cursor-pointer outline-none' : undefined}
              role={props.interactive || props.onInspect ? 'button' : undefined}
              tabIndex={props.interactive || props.onInspect ? 0 : undefined}
              aria-label={`${section.label}${selected ? ', selected' : ''}`}
              aria-pressed={props.interactive ? selected : undefined}
              data-testid={`coverage-section-${section.id}`}
              onClick={click}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  click();
                }
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
