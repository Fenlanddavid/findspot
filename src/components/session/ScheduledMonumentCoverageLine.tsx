import { getSMUnavailableCopy } from '../fieldGuide/SMUnavailableBanner';
import type { ScheduledMonumentMapCoverage } from '../../services/session/sessionScheduledMonuments';

const NATION_LABELS: Record<string, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
};

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function sourceNames(state: ScheduledMonumentMapCoverage): string[] {
  if (state.dataset?.sources.length) return state.dataset.sources;
  const covered = new Set(state.coveredNations);
  return [
    covered.has('england') ? 'NHLE' : null,
    covered.has('wales') ? 'Cadw' : null,
    covered.has('scotland') ? 'HES' : null,
  ].filter((source): source is string => !!source);
}

function formatDataDate(value: string | undefined): string {
  if (!value) return 'data date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data date unavailable';
  return `data ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date)}`;
}

function formatShortDataDate(value: string | undefined): string {
  if (!value) return 'data date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data date unavailable';
  const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(date);
}

export function scheduledMonumentCoverageForm(
  state: ScheduledMonumentMapCoverage,
): 'short' | 'full' {
  return state.status === 'ready'
    && state.unavailableReason === null
    && state.classification === 'covered'
    ? 'short'
    : 'full';
}

function scheduledMonumentCoverageShortParts(state: ScheduledMonumentMapCoverage) {
  return {
    sources: sourceNames(state).join(', '),
    date: formatShortDataDate(state.dataset?.builtAt),
  };
}

export function scheduledMonumentCoverageShortText(state: ScheduledMonumentMapCoverage): string {
  const { sources, date } = scheduledMonumentCoverageShortParts(state);
  return ['Scheduled monuments', sources || null, date].filter(Boolean).join(' · ');
}

export function scheduledMonumentCoverageText(state: ScheduledMonumentMapCoverage): string {
  if (state.status === 'loading') return 'Scheduled monuments · checking cached coverage…';

  const details = ['Scheduled monuments'];
  const sources = sourceNames(state);
  if (sources.length) details.push(sources.join(', '));
  if (state.dataset) details.push(formatDataDate(state.dataset.builtAt));
  if (state.coveredNations.length) {
    details.push(`${joinLabels(state.coveredNations.map(nation => NATION_LABELS[nation] ?? nation))} coverage`);
  }

  if (state.unavailableReason) {
    details.push(getSMUnavailableCopy(state.unavailableReason, 'Scheduled monument coverage is unavailable.').title);
  }
  if (state.status === 'not_cached') details.push('Data not downloaded for this area');
  if (state.status === 'error') {
    details.push(getSMUnavailableCopy(null, 'Scheduled monument coverage is unavailable.').title);
  }

  return details.join(' · ');
}

export function ScheduledMonumentCoverageLine({ state }: { state: ScheduledMonumentMapCoverage }) {
  const form = scheduledMonumentCoverageForm(state);
  const shortParts = scheduledMonumentCoverageShortParts(state);
  const fullText = scheduledMonumentCoverageText(state);

  return (
    <>
      {form === 'short' ? (
        <div
          data-testid="scheduled-monument-coverage"
          data-rendered-feature-count={state.renderedFeatureCount}
          data-coverage-form="short"
          className="scheduled-monument-coverage-short pointer-events-none absolute bottom-0 left-0 z-[90] flex max-w-[calc(100%-3.5rem)] items-center gap-1.5 overflow-hidden whitespace-nowrap px-2 py-1 text-left text-xs leading-tight"
        >
          <span aria-hidden="true" className="scheduled-monument-map-key h-3 w-3 shrink-0" />
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            <span className="shrink-0">Scheduled monuments</span>
            {shortParts.sources && (
              <>
                <span aria-hidden="true" className="shrink-0">·</span>
                <span className="min-w-0 truncate">{shortParts.sources}</span>
              </>
            )}
            <span aria-hidden="true" className="shrink-0">·</span>
            <span className="shrink-0">{shortParts.date}</span>
          </span>
        </div>
      ) : (
        <div
          data-testid="scheduled-monument-coverage"
          data-rendered-feature-count={state.renderedFeatureCount}
          data-coverage-form="full"
          className="pointer-events-none absolute bottom-0 left-0 z-[90] flex max-w-[calc(100%-3.5rem)] items-center gap-1.5 bg-gradient-to-r from-gray-950/75 via-gray-950/55 to-transparent py-1 pl-2 pr-8 text-xs leading-tight text-white/90"
        >
          <span aria-hidden="true" className="scheduled-monument-map-key h-3 w-3 shrink-0" />
          <span>{fullText}</span>
        </div>
      )}
    </>
  );
}
