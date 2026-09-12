import type { Permission } from '../db';

/** Saved permissions need no optional boundary/contact fields to start a visit. */
export function permissionAction(permission: Pick<Permission, 'id'> & { activeSessionId?: string | null }) {
  if (permission.activeSessionId) return { label: 'Resume visit', href: `/session/${encodeURIComponent(permission.activeSessionId)}` };
  return { label: 'Start visit', href: `/session/new?permissionId=${encodeURIComponent(permission.id)}` };
}
