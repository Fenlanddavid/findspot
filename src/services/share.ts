import html2canvas from 'html2canvas';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

async function captureCard(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 1,
    useCORS: true,
    logging: false,
    backgroundColor: '#020617',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 0.9));
  if (!blob) throw new Error('Failed to create image blob');
  return blob;
}

/**
 * Captures the share card and opens the native share sheet (Web Share API).
 * Falls back to download if sharing is not supported.
 */
export async function shareElementAsImage(element: HTMLElement, filename: string, title: string, text: string) {
  const blob = await captureCard(element);
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
export async function downloadShareCard(element: HTMLElement, filename: string) {
  const blob = await captureCard(element);
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
