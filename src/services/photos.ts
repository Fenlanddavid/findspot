const MAX_PX = 1600;
const QUALITY = 0.85;

export async function fileToBlob(file: File): Promise<Blob> {
  // Only compress images; pass other file types straight through
  if (!file.type.startsWith("image/")) return file.slice(0, file.size, file.type);

  // Probe dimensions — createImageBitmap is GPU-backed so doesn't spike JS heap
  const probe = await createImageBitmap(file);
  const w = probe.width;
  const h = probe.height;
  probe.close(); // free GPU memory before the resize step

  const scale = Math.min(1, MAX_PX / Math.max(w, h));
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  // Resize during hardware decode — avoids loading the full-res bitmap into JS heap.
  // Critical for high-megapixel cameras (50MP+ = ~200MB uncompressed) on mobile WebViews.
  const bitmap = await createImageBitmap(file, {
    resizeWidth: targetW,
    resizeHeight: targetH,
    resizeQuality: "high",
  });

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      QUALITY,
    );
  });
}
