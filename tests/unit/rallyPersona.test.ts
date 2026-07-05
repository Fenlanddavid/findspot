import { describe, it, expect } from "vitest";
import { rallyPersona } from "../../src/utils/rallyPersona";

const BASE = {
  type: "individual" as const,
  isClubDayMember: undefined,
  isPersonalRallyRecord: undefined,
  isSharedPermission: undefined,
  sharedPermissionId: undefined,
};

describe("rallyPersona", () => {
  it("individual permission → not_rally", () => {
    expect(rallyPersona({ ...BASE })).toBe("not_rally");
  });

  it("solo rally, no pack → personal", () => {
    expect(rallyPersona({ ...BASE, type: "rally" })).toBe("personal");
  });

  it("rally + isSharedPermission → organiser", () => {
    expect(
      rallyPersona({ ...BASE, type: "rally", isSharedPermission: true })
    ).toBe("organiser");
  });

  it("rally + sharedPermissionId only → organiser", () => {
    expect(
      rallyPersona({ ...BASE, type: "rally", sharedPermissionId: "abc" })
    ).toBe("organiser");
  });

  it("member flags beat everything (member + shared → member)", () => {
    expect(
      rallyPersona({
        ...BASE,
        type: "rally",
        isClubDayMember: true,
        isSharedPermission: true,
      })
    ).toBe("member");
  });

  it("kept_record beats organiser signals", () => {
    expect(
      rallyPersona({
        ...BASE,
        type: "rally",
        isPersonalRallyRecord: true,
        isSharedPermission: true,
      })
    ).toBe("kept_record");
  });

  it("persona transition: same object before/after isSharedPermission flip", () => {
    const p = { ...BASE, type: "rally" as const };
    expect(rallyPersona(p)).toBe("personal");

    // Simulate pack creation
    const after = { ...p, isSharedPermission: true };
    expect(rallyPersona(after)).toBe("organiser");
  });
});
