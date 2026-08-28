const MAX_EXTERNAL_URL_CHARS = 2_048;

export function safeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_CHARS) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
