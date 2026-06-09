import html2canvas from 'html2canvas';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

interface CaptureOptions {
  scale?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
}

async function captureCard(element: HTMLElement, options: CaptureOptions = {}): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale:           options.scale           ?? 1,
    width:           options.width           ?? CARD_WIDTH,
    height:          options.height          ?? CARD_HEIGHT,
    backgroundColor: options.backgroundColor ?? '#020617',
    useCORS: true,
    logging: false,
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.9));
  if (!blob) throw new Error('Failed to create image blob');
  return blob;
}

/**
 * Captures the share card and opens the native share sheet (Web Share API).
 * Falls back to download if sharing is not supported.
 */
export async function shareElementAsImage(
  element: HTMLElement,
  filename: string,
  title: string,
  text: string,
  options: CaptureOptions = {},
) {
  const blob = await captureCard(element, options);
  const file = new File([blob], `${filename}.png`, { type: 'image/png' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title, text });
  } else {
    triggerDownload(blob, filename);
  }
}

/**
 * Captures the share card and saves it directly to the device downloads / photo library.
 * Bypasses the share sheet entirely — use this for "Save to Photos" flow.
 */
export async function downloadShareCard(element: HTMLElement, filename: string, options: CaptureOptions = {}) {
  const blob = await captureCard(element, options);
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  triggerDownloadFile(blob, `${filename}.png`);
}

function triggerDownloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function extensionForBlob(blob: Blob): string {
  switch (blob.type) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    default:
      return 'jpg';
  }
}

export function ensureFilenameExtension(filename: string, blob: Blob): string {
  return /\.[a-z0-9]{2,5}$/i.test(filename) ? filename : `${filename}.${extensionForBlob(blob)}`;
}

export function makeFindPhotoFilename(findId: string, photoNumber: number, blob: Blob): string {
  const safeFindId = (findId || 'find').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '') || 'find';
  return `findspot-${safeFindId}-photo-${photoNumber}.${extensionForBlob(blob)}`;
}

/**
 * Shares an original blob via the native share sheet where supported.
 * Falls back to a browser download using the supplied filename.
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  shareTitle = 'FindSpot file',
): Promise<void> {
  const resolvedFilename = ensureFilenameExtension(filename, blob);
  const file = new File([blob], resolvedFilename, { type: blob.type || 'application/octet-stream' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ title: shareTitle, files: [file] });
    return;
  }

  triggerDownloadFile(blob, resolvedFilename);
}

export async function shareOrDownloadBlobs(
  files: Array<{ blob: Blob; filename: string }>,
  shareTitle = 'FindSpot files',
): Promise<void> {
  const shareFiles = files.map(({ blob, filename }) => (
    new File([blob], ensureFilenameExtension(filename, blob), { type: blob.type || 'application/octet-stream' })
  ));

  if (shareFiles.length > 0 && navigator.share && navigator.canShare && navigator.canShare({ files: shareFiles })) {
    await navigator.share({ title: shareTitle, files: shareFiles });
    return;
  }

  for (const { blob, filename } of files) {
    triggerDownloadFile(blob, ensureFilenameExtension(filename, blob));
  }
}
