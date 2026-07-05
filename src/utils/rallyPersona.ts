// ─── Rally Persona — derived identity, never stored ──────────────────────────
// Precedence: member > kept_record > organiser > personal

import type { Permission } from "../db";

export type RallyPersona =
  | "not_rally"
  | "member"
  | "kept_record"
  | "organiser"
  | "personal";

export function rallyPersona(
  p: Pick<
    Permission,
    | "type"
    | "isClubDayMember"
    | "isPersonalRallyRecord"
    | "isSharedPermission"
    | "sharedPermissionId"
  >
): RallyPersona {
  if (
    p.type !== "rally" &&
    !p.isClubDayMember &&
    !p.isPersonalRallyRecord &&
    !p.isSharedPermission
  )
    return "not_rally";
  if (p.isClubDayMember) return "member";
  if (p.isPersonalRallyRecord) return "kept_record";
  if (p.isSharedPermission || p.sharedPermissionId) return "organiser";
  return p.type === "rally" ? "personal" : "not_rally";
}
