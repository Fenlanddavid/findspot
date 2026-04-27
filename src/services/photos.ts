const MAX_PX = 1600;
const QUALITY = 0.85;

export async function fileToBlob(file: File): Promise<Blob> {
  // Only compress images; pass other file types straight through
  if (!file.type.startsWith("image/")) return file.slice(0, file.size, file.type);

  // Use GPU-backed createImageBitmap when available (avoids spiking JS heap with
  // full-res bitmaps — critical for 50MP+ cameras on Android WebViews).
  // Fall back to the classic Image + canvas path for older browsers/WebViews.
  if (typeof createImageBitmap !== "undefined") {
    try {
      // Probe dimensions without loading pixel data into JS heap
      const probe = await createImageBitmap(file);
      const w = probe.width;
      const h = probe.height;
      probe.close();

      const scale = Math.min(1, MAX_PX / Math.max(w, h));
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);

      // Resize during hardware decode — never loads the full-res bitmap into JS heap
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
    } catch {
      // Fall through to legacy path
    }
  }

  // Legacy path: Image + canvas (loads full bitmap into JS heap, but widely supported)
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const targetW = Math.round(img.width * scale);
      const targetH = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas 2D context unavailable"));
      ctx.drawImage(img, 0, 0, targetW, targetH);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
        "image/jpeg",
        QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}
