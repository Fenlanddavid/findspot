import { db, type FindSpotDB } from '../db';
import { collectionFacts } from './collections';
import { orderCollectionItems } from './collectionModels';

export type PublicCollectionPhoto = { blob: Blob; x: number; y: number };
export type PublicCollectionObject = { title: string; caption: string; interpretation: string; facts: Array<{ label: string; value: string }>; photos: PublicCollectionPhoto[]; missingPhotos: number };
export type PublicCollection = { title: string; introduction: string; publicDetectorLabel?: string; cover?: PublicCollectionPhoto; objects: PublicCollectionObject[] };

/** This is the only boundary from private records to public layouts. No spreads of source records. */
export async function capturePublicCollection(id: string, projectId: string, selectedItemIds: string[], database: FindSpotDB = db): Promise<PublicCollection> {
  return database.transaction('r', [database.collections, database.collectionItems, database.finds, database.media], async () => {
    const collection = await database.collections.get(id);
    if (collection?.projectId !== projectId) throw new Error('Collection is unavailable.');
    const allItems = orderCollectionItems(await database.collectionItems.where('collectionId').equals(id).toArray());
    const items = allItems.filter(item => selectedItemIds.includes(item.id));
    const coverItemId = collection.coverItemId ?? allItems[0]?.id;
    if (!items.length) throw new Error('Choose at least one object to export.');
    if (items.length !== new Set(selectedItemIds).size) throw new Error('The collection changed. Review the selected objects again.');
    const objects: PublicCollectionObject[] = [];
    let cover: PublicCollectionPhoto | undefined;
    for (const item of items) {
      const find = await database.finds.get(item.findId);
      if (find?.projectId !== projectId) throw new Error('A source find is unavailable. Remove it from this export or repair the collection.');
      const photos: PublicCollectionPhoto[] = [];
      let missingPhotos = 0;
      for (const mediaId of item.selectedMediaIds) {
        const media = await database.media.get(mediaId);
        if (!media || media.findId !== find.id || media.projectId !== projectId || media.type !== 'photo') { missingPhotos++; continue; }
        const photo = { blob: media.blob, x: item.cropSettings?.[mediaId]?.x ?? 50, y: item.cropSettings?.[mediaId]?.y ?? 50 };
        photos.push(photo);
        if (item.id === coverItemId && mediaId === item.selectedMediaIds[0]) cover = photo;
      }
      objects.push({ title: item.displayTitle || find.objectType || 'Unidentified find', caption: item.caption || '', interpretation: item.interpretationStatus === 'tentative' ? 'Tentative interpretation' : item.interpretationStatus === 'supported' ? 'Interpretation: user considers supported' : '', facts: collectionFacts(find, item.selectedFactFields), photos, missingPhotos });
    }
    return { title: collection.title, introduction: collection.introduction, cover, objects };
  });
}

const WIDTH = 1080, HEIGHT = 1350, MARGIN = 76;
export type CollectionExportPage = { blob: Blob; filename: string };
export function wrapExportText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  // Break long unspaced words too. Unicode code points are never split in half.
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (context.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      for (const char of word.trimStart()) {
        if (context.measureText(line + char).width > width && line) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function cancelled(signal: AbortSignal) { signal.throwIfAborted(); }
async function drawPhoto(context: CanvasRenderingContext2D, photo: PublicCollectionPhoto, x: number, y: number, width: number, height: number) {
  const bitmap = await createImageBitmap(photo.blob, { resizeWidth: 1600, resizeQuality: 'high' });
  try {
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sourceWidth = width / scale, sourceHeight = height / scale;
    context.drawImage(bitmap, (bitmap.width - sourceWidth) * photo.x / 100, (bitmap.height - sourceHeight) * photo.y / 100, sourceWidth, sourceHeight, x, y, width, height);
  } finally { bitmap.close(); }
}

/** Fresh pixels only: never copy original photo bytes, metadata or filenames to output. */
export async function renderCollectionPages(data: PublicCollection, signal: AbortSignal, onProgress: (pages: number) => void): Promise<CollectionExportPage[]> {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Image rendering is unavailable.');
  const pages: CollectionExportPage[] = []; let totalBytes = 0; let y = MARGIN;
  function start() { cancelled(signal); context!.fillStyle = '#f7f4ed'; context!.fillRect(0, 0, WIDTH, HEIGHT); context!.fillStyle = '#20382d'; y = MARGIN; }
  async function finish() {
    cancelled(signal); context!.fillStyle = '#52685a'; context!.font = '24px sans-serif'; context!.fillText(`FindSpot · findspot.uk`, MARGIN, HEIGHT - 45); context!.textAlign = 'right'; context!.fillText(String(pages.length + 1), WIDTH - MARGIN, HEIGHT - 45); context!.textAlign = 'left';
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode export image.')), 'image/png'));
    cancelled(signal); totalBytes += blob.size;
    if (totalBytes > 64 * 1024 * 1024 || pages.length >= 200) throw new Error('This export is too large for one batch. Choose fewer objects and prepare separate exports.');
    pages.push({ blob, filename: `findspot-collection-${String(pages.length + 1).padStart(3, '0')}.png` }); onProgress(pages.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  async function textBlock(text: string, size = 40, serif = false) {
    const font = `${size}px ${serif ? 'serif' : 'sans-serif'}`; context!.font = font;
    const lineHeight = Math.ceil(size * 1.4);
    const lines = wrapExportText(context!, text, WIDTH - MARGIN * 2);
    for (const line of lines) {
      if (y + lineHeight > HEIGHT - 110) { await finish(); start(); context!.font = font; }
      context!.fillStyle = '#20382d'; context!.fillText(line, MARGIN, y + size); y += lineHeight;
    }
    y += 24;
  }
  try {
    if (data.publicDetectorLabel && data.publicDetectorLabel.length > 100) throw new Error('The public detector label must be 100 characters or fewer.');
    start(); await textBlock(data.title, 62, true);
    if (data.publicDetectorLabel) await textBlock(`Detector: ${data.publicDetectorLabel}`, 34);
    if (data.cover && y + 530 < HEIGHT - 110) { await drawPhoto(context, data.cover, MARGIN, y, WIDTH - MARGIN * 2, 500); y += 530; }
    await textBlock(data.introduction || 'A personal collection of discoveries.'); await finish();
    for (const object of data.objects) {
      start(); await textBlock(object.title, 48, true);
      if (object.photos.length) {
        const width = (WIDTH - MARGIN * 2 - (object.photos.length - 1) * 20) / object.photos.length;
        if (y + 440 > HEIGHT - 110) { await finish(); start(); }
        for (let index = 0; index < object.photos.length; index++) { cancelled(signal); await drawPhoto(context, object.photos[index], MARGIN + index * (width + 20), y, width, 400); }
        y += 430;
      } else await textBlock('No photograph selected', 34);
      if (object.missingPhotos) await textBlock('Selected photograph unavailable', 34);
      for (const fact of object.facts) await textBlock(`${fact.label}: ${fact.value}`, 36);
      if (object.interpretation) await textBlock(object.interpretation, 34);
      if (object.caption) await textBlock(object.caption);
      await finish();
    }
    return pages;
  } finally { canvas.width = 0; canvas.height = 0; }
}

export async function collectionZip(pages: CollectionExportPage[], signal: AbortSignal): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const page of pages) { cancelled(signal); entries[page.filename] = new Uint8Array(await page.blob.arrayBuffer()); }
  cancelled(signal);
  return new Blob([new Uint8Array(zipSync(entries, { level: 0 }))], { type: 'application/zip' });
}
export async function collectionPdf(pages: CollectionExportPage[], signal: AbortSignal): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: 'FindSpot collection', subject: '', author: '', keywords: '', creator: 'FindSpot' });
  for (let index = 0; index < pages.length; index++) {
    cancelled(signal); if (index) pdf.addPage();
    // JPEG keeps the PDF's retained page data bounded; jsPDF need not retain
    // full uncompressed PNG pixels for every page of a long booklet.
    const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    try {
      const bitmap = await createImageBitmap(pages[index].blob);
      try { const context = canvas.getContext('2d'); if (!context) throw new Error('PDF image rendering is unavailable.'); context.drawImage(bitmap, 0, 0); }
      finally { bitmap.close(); }
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare a PDF page.')), 'image/jpeg', .95));
      cancelled(signal);
      pdf.addImage(new Uint8Array(await jpeg.arrayBuffer()), 'JPEG', 10, 18, 190, 237.5);
    } finally { canvas.width = 0; canvas.height = 0; }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  cancelled(signal); return pdf.output('blob');
}
