/** Prepare a browser download; this cannot confirm that the user saved the file. */
export function triggerDownload(blob: Blob, filename: string): void {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL alive for asynchronous download starts and large backup ZIPs.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
