import type {
  LandscapeInterpretation,
  LandscapeInterpretationWorkerInput,
} from '../types/landscapeInterpretation';
import { runWorkerRequest } from './client';
import { createLandscapeInterpretationWorker } from './factory';

const LANDSCAPE_INTERPRETATION_TIMEOUT_MS = 20_000;

export function runLandscapeInterpretationWorker(
  input: LandscapeInterpretationWorkerInput,
  signal?: AbortSignal,
): Promise<LandscapeInterpretation> {
  return runWorkerRequest({
    createWorker: createLandscapeInterpretationWorker,
    payload: input,
    signal,
    timeoutMs: LANDSCAPE_INTERPRETATION_TIMEOUT_MS,
  });
}
