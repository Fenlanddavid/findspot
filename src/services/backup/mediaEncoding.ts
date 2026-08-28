export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function base64ToBlob(base64: string): Promise<Blob> {
  const match = /^data:([A-Za-z0-9][A-Za-z0-9!#$&^_.+\/-]{0,127});base64,([A-Za-z0-9+/]*={0,2})$/.exec(base64);
  if (!match || match[2].length % 4 !== 0) {
    throw new Error('Invalid encoded media.');
  }
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error('Invalid encoded media.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}
