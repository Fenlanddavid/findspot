const APP_ORIGIN = 'https://fenlanddavid.github.io';

export function configuredOrigins(value?: string): Set<string> {
  return new Set((value ?? `${APP_ORIGIN},http://localhost:5173,http://127.0.0.1:5173`)
    .split(',')
    .map(entry => entry.trim().replace(/\/$/, ''))
    .filter(Boolean));
}

export function originAllowed(origin: string | null, configured?: string): boolean {
  if (origin === null) return false;
  return configuredOrigins(configured).has(origin.replace(/\/$/, ''));
}
