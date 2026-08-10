import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Permission } from '../../db';
import { getPermissionScanTarget } from '../../outstandingQuestions/permissionScanTarget';
import { captureGPS } from '../../services/gps';
import { resolveEffectiveScatter, type SurfaceScope } from '../../services/surfaceScatter';
import { ObservedByYouBlock, RecordSurfaceFindButton } from './ObservedByYouBlock';

/**
 * Permission-scoped surface observations for the Landscape investigations card.
 * This is presentation-only and never enters FieldGuide or an engine result.
 */
export function PermissionSurfaceObservations({ permission }: { permission: Permission }) {
  const rows = useLiveQuery(async () => {
    const [observations, sections] = await Promise.all([
      db.surfaceObservations.where('permissionId').equals(permission.id).toArray(),
      db.permissionSections.where('permissionId').equals(permission.id).toArray(),
    ]);
    return { observations, sections };
  }, [permission.id]);

  const scatter = useMemo(() => {
    const observations = rows?.observations ?? [];
    const point = getPermissionScanTarget(permission)
      ?? (observations[0] ? { lat: observations[0].lat, lon: observations[0].lon } : null);
    const scope: SurfaceScope | null = point
      ? { permissionId: permission.id, sectionId: null, point }
      : null;
    return resolveEffectiveScatter({
      observations,
      sections: rows?.sections ?? [],
      scope,
    });
  }, [permission, rows]);

  const recordButton = (
    <RecordSurfaceFindButton
      compact
      projectId={permission.projectId}
      permissionId={permission.id}
      getLocation={captureGPS}
    />
  );
  const recordIconButton = (
    <RecordSurfaceFindButton
      icon
      projectId={permission.projectId}
      permissionId={permission.id}
      getLocation={captureGPS}
    />
  );

  return (
    <div className="relative mx-4 mt-3 sm:mx-5">
      <ObservedByYouBlock
        scatter={scatter}
        recordButton={recordButton}
        recordIconButton={recordIconButton}
      />
    </div>
  );
}
