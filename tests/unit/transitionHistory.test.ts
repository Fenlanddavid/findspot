import { describe, expect, it } from 'vitest';
import {
  MAX_SUPERSEDE_CHAIN_DEPTH,
  terminalSupersedingQuestionId,
} from '../../src/outstandingQuestions/transitionHistory';

describe('supersession ancestry', () => {
  it('walks a three-question chain to its terminal survivor', () => {
    const questions = new Map([
      ['a', { id: 'a', supersededByIds: ['b'] }],
      ['b', { id: 'b', supersededByIds: ['c'] }],
      ['c', { id: 'c' }],
    ]);
    expect(terminalSupersedingQuestionId('a', questions)).toBe('c');
  });

  it('stops safely at the depth cap', () => {
    const questions = new Map(Array.from({ length: MAX_SUPERSEDE_CHAIN_DEPTH + 2 }, (_, index) => [
      String(index),
      { id: String(index), supersededByIds: [String(index + 1)] },
    ]));
    expect(terminalSupersedingQuestionId('0', questions)).toBe(String(MAX_SUPERSEDE_CHAIN_DEPTH));
  });
});
