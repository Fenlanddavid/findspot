/** The only application module permitted to construct dedicated workers. */
export function createTerrainScanWorker(): Worker {
  return new Worker(
    new URL('./terrainScanWorker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function createLandscapeInterpretationWorker(): Worker {
  return new Worker(
    new URL('./landscapeInterpretation.worker.ts', import.meta.url),
    { type: 'module' },
  );
}
