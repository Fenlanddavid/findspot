/** Format GPS accuracy for display — never claims ±0. */
export function formatAccuracy(meters: number): string {
  if (meters < 1) return '±1 m or better';
  if (meters >= 100) return '±100 m or worse';
  return `±${Math.round(meters)} m`;
}
