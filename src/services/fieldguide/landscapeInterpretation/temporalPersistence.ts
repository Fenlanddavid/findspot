// ─── Temporal Persistence ────────────────────────────────────────────────────
// Computes how long a landscape appears to have remained in active use,
// based on the number of period bands with meaningful certainty-weighted records.

import type { PeriodSignalAggregate, TemporalPersistenceLabel } from '../../../types/landscapeInterpretation';

export interface TemporalPersistenceResult {
    label: TemporalPersistenceLabel;
    recordSparsity: boolean;
}

export function computeTemporalPersistence(
    periodAggregates: PeriodSignalAggregate[],
): TemporalPersistenceResult {
    // Count period bands with certaintyWeightedCount >= 0.5
    const activePeriods = periodAggregates.filter(a => a.certaintyWeightedCount >= 0.5).length;

    let label: TemporalPersistenceLabel;
    if (activePeriods >= 5) {
        label = 'persistent_strategic_focus';
    } else if (activePeriods >= 3) {
        label = 'persistent';
    } else if (activePeriods === 2) {
        label = 'recurrent';
    } else {
        label = 'transient';
    }

    // Sparsity: total record count across all periods < 3
    const totalRecords = periodAggregates.reduce((sum, a) => sum + a.recordCount, 0);
    const recordSparsity = totalRecords < 3;

    return { label, recordSparsity };
}
