import { describe, expect, it } from 'vitest';
import {
  FIELDWORK_PROGRESS_VALUES,
  INTERPRETATION_DIRECTION_VALUES,
} from '../../src/outstandingQuestions/investigationState';
import { INTERPRETATION_COPY } from '../../src/outstandingQuestions/interpretationCopy';
import { HYPOTHESIS_BY_RULE } from '../../src/outstandingQuestions/types';

describe('investigation interpretation copy', () => {
  it('is total across the 4 × 4 × 5 matrix', () => {
    const hypotheses = [...new Set(Object.values(HYPOTHESIS_BY_RULE))];
    const expectedKeys = hypotheses.flatMap(hypothesis =>
      FIELDWORK_PROGRESS_VALUES.flatMap(progress =>
        INTERPRETATION_DIRECTION_VALUES.map(direction => `${hypothesis}:${progress}:${direction}`)
      )
    );

    expect(hypotheses).toHaveLength(4);
    expect(expectedKeys).toHaveLength(80);
    expect(Object.keys(INTERPRETATION_COPY)).toHaveLength(80);
    for (const key of expectedKeys) {
      expect(INTERPRETATION_COPY[key as keyof typeof INTERPRETATION_COPY], key).toEqual({
        short: expect.any(String),
        full: expect.any(String),
      });
    }
  });

  it('avoids target-finding promises and directions', () => {
    const copy = Object.values(INTERPRETATION_COPY)
      .flatMap(value => [value.short, value.full])
      .join('\n');

    expect(copy).not.toMatch(/where to detect|detect here|go detect|search here|will find|guarantee|definitely|proves|treasure/i);
  });
});
