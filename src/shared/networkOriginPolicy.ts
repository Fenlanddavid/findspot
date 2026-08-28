import entries from './networkOrigins.json';

const automaticOrigins = new Set(
  entries
    .filter(entry => entry.class === 'automatic')
    .map(entry => entry.origin),
);

export function approvedAutomaticBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'https:' || !automaticOrigins.has(url.origin)) {
    throw new Error(`${label} uses an unapproved network origin.`);
  }
  return value.replace(/\/$/, '');
}
