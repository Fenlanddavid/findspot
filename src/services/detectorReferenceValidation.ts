/** Missing is distinct from zero. Never parse a numeric prefix or infer a scale. */
export function isUsableTargetId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function parseTargetId(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  if (!/^[+-]?\d+$/.test(value) || !isUsableTargetId(Number(value))) {
    throw new Error('Enter a whole-number target ID, such as 0, -9 or 24.');
  }
  return Number(value);
}

/** Preserve an unchanged legacy value when editing unrelated record details. */
export function assertTargetIdMutation(value: unknown, previous?: unknown): void {
  if (value === undefined || Object.is(value, previous) || isUsableTargetId(value)) return;
  throw new Error('Target ID must be a whole number. Missing readings must be left blank.');
}

export function parseTargetRange(lower: string, upper: string): [number, number] {
  const min = parseTargetId(lower);
  const max = parseTargetId(upper);
  if (min === undefined || max === undefined) throw new Error('Enter both range bounds.');
  if (min > max) throw new Error('The lower target ID must not exceed the upper target ID.');
  return [min, max];
}
