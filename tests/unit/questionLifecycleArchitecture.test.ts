import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const OUTSTANDING_QUESTIONS_DIRECTORY = new URL('../../src/outstandingQuestions/', import.meta.url);
const CANDIDATE_ONLY_MODULES = new Set(['generator.ts', 'rules.ts', 'types.ts']);
const PERSISTED_STATUS_LITERAL = /\bstatus\s*:\s*['"](?:UNRESOLVED|NEEDS_EVIDENCE|WEAKENING|RESOLVED)['"]/g;

describe('question lifecycle architecture', () => {
  it('keeps persisted lifecycle status assignments inside the state machine', async () => {
    const moduleNames = (await readdir(OUTSTANDING_QUESTIONS_DIRECTORY))
      .filter(name => name.endsWith('.ts'))
      .filter(name => name !== 'questionStateMachine.ts')
      .filter(name => !CANDIDATE_ONLY_MODULES.has(name));
    const violations: string[] = [];

    for (const moduleName of moduleNames) {
      const source = await readFile(new URL(moduleName, OUTSTANDING_QUESTIONS_DIRECTORY), 'utf8');
      if (PERSISTED_STATUS_LITERAL.test(source)) violations.push(moduleName);
      PERSISTED_STATUS_LITERAL.lastIndex = 0;
    }

    expect(violations).toEqual([]);
  });

  it('prevents the differ from directly assigning lifecycle fields', async () => {
    const source = await readFile(new URL('differ.ts', OUTSTANDING_QUESTIONS_DIRECTORY), 'utf8');

    expect(source).not.toMatch(/\b(?:status|resolvedReason|resolvedAt|supersededByIds)\s*:/);
    expect(source).not.toMatch(/\.(?:status|resolvedReason|resolvedAt|supersededByIds)\s*=(?!=)/);
    expect(source).toContain('applyQuestionTransition');
  });

  it('prevents UI writes from updating persisted lifecycle status directly', async () => {
    const source = await readFile(
      new URL('../../src/components/OutstandingQuestionsCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/outstandingQuestions\.update\([^,]+,\s*\{[^}]*\bstatus\s*:/s);
  });
});
