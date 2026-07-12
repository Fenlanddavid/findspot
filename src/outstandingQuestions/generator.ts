// ─── Outstanding Questions — generator ──────────────────────────────────────
// Pure function: (scanContext, gateContext) => QuestionCandidate[]
// Runs rules, applies gates, returns post-gate candidates (pre-cap/diff).

import type { QuestionCandidate } from './types';
import type { GateContext } from './gates';
import { passesAllGates } from './gates';
import { runRules, type ScanContext } from './rules';

/**
 * Generate question candidates from scan output.
 * Pure function — no I/O, no Dexie, no engine imports.
 */
export function generateCandidates(
  scanCtx: ScanContext,
  gateCtx: GateContext,
): QuestionCandidate[] {
  const raw = runRules(scanCtx);
  return raw.filter(c => passesAllGates(c, gateCtx));
}
