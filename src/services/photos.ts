export async function fileToBlob(file: File): Promise<Blob> {
  return file.slice(0, file.size, file.type);
}
