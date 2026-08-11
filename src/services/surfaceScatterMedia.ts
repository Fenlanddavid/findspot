import { v4 as uuid } from 'uuid';
import { db, type FindSpotDB, type Media } from '../db';
import { fileToBlob } from './photos';

export async function addSurfaceObservationPhoto(
  observationId: string,
  file: File,
  database: FindSpotDB = db,
): Promise<Media> {
  const observation = await database.surfaceObservations.get(observationId);
  if (!observation) throw new Error('Surface observation not found.');
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const blob = await fileToBlob(file);
  const media: Media = {
    id: uuid(),
    projectId: observation.projectId,
    permissionId: observation.permissionId,
    surfaceObservationId: observation.id,
    type: 'photo',
    photoType: 'other',
    filename: file.name || `surface-observation-${observation.id}.jpg`,
    mime: blob.type || file.type || 'image/jpeg',
    blob,
    caption: '',
    scalePresent: false,
    createdAt: new Date().toISOString(),
  };
  await database.media.add(media);
  return media;
}

export async function deleteSurfaceObservationPhoto(
  observationId: string,
  mediaId: string,
  database: FindSpotDB = db,
): Promise<void> {
  const media = await database.media.get(mediaId);
  if (!media || media.surfaceObservationId !== observationId) {
    throw new Error('Surface observation photo not found.');
  }
  await database.media.delete(mediaId);
}
