// ─── Storage Persistence Service tests ────────────────────────────────────────
// Covers src/services/storagePersistence.ts
//
// Tests:
//   1. persisted() true  → "protected"; persist() NOT called
//   2. persisted() false, no attempted flag → persist() called once,
//      flag written BEFORE the call, state recorded
//   3. persisted() false, attempted flag already set → persist() NOT called,
//      state "best_effort"
//   4. navigator.storage absent → "unknown", no DB write errors
//   5. persisted() throws / persist() throws → "unknown", startup still resolves
//   6. Timeout race: persist() never resolves → resolves "unknown" within window

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DB mock ──────────────────────────────────────────────────────────────────

// hoisted so vi.mock factory can reference them
const mockSettingsStore = vi.hoisted(() => ({} as Record<string, unknown>));
const callOrder = vi.hoisted(() => [] as string[]);

const mockPut = vi.hoisted(() =>
  vi.fn().mockImplementation(async (row: { key: string; value: unknown }) => {
    callOrder.push(`put:${row.key}`);
    mockSettingsStore[row.key] = row.value;
  })
);
const mockGet = vi.hoisted(() =>
  vi.fn().mockImplementation(async (key: string) => {
    const value = mockSettingsStore[key];
    return value !== undefined ? { key, value } : undefined;
  })
);

vi.mock("../../src/db", () => ({
  db: {
    settings: {
      put: mockPut,
      get: mockGet,
    },
  },
}));

// Import AFTER mock
import {
  getProtectionState,
  requestProtection,
  ensureProtectionOnStartup,
} from "../../src/services/storagePersistence";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStorageApi({
  persisted,
  persist,
}: {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}) {
  Object.defineProperty(navigator, "storage", {
    value: {
      ...(persisted !== undefined ? { persisted } : {}),
      ...(persist !== undefined ? { persist } : {}),
    },
    writable: true,
    configurable: true,
  });
}

function removeStorageApi() {
  Object.defineProperty(navigator, "storage", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  Object.keys(mockSettingsStore).forEach((k) => delete mockSettingsStore[k]);
});

afterEach(() => {
  removeStorageApi();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getProtectionState", () => {
  it("returns 'protected' when persisted() is true", async () => {
    setStorageApi({ persisted: async () => true });
    expect(await getProtectionState()).toBe("protected");
  });

  it("returns 'best_effort' when persisted() is false", async () => {
    setStorageApi({ persisted: async () => false });
    expect(await getProtectionState()).toBe("best_effort");
  });

  it("returns 'unknown' when navigator.storage is absent", async () => {
    removeStorageApi();
    expect(await getProtectionState()).toBe("unknown");
  });

  it("returns 'unknown' when persisted() throws", async () => {
    setStorageApi({
      persisted: async () => {
        throw new Error("denied");
      },
    });
    expect(await getProtectionState()).toBe("unknown");
  });
});

describe("requestProtection", () => {
  it("returns 'protected' when persist() resolves true", async () => {
    setStorageApi({ persisted: async () => false, persist: async () => true });
    expect(await requestProtection()).toBe("protected");
  });

  it("returns 'best_effort' when persist() resolves false", async () => {
    setStorageApi({ persisted: async () => false, persist: async () => false });
    expect(await requestProtection()).toBe("best_effort");
  });

  it("returns 'unknown' when navigator.storage is absent", async () => {
    removeStorageApi();
    expect(await requestProtection()).toBe("unknown");
  });

  it("returns 'unknown' when persist() throws", async () => {
    setStorageApi({
      persisted: async () => false,
      persist: async () => {
        throw new Error("no");
      },
    });
    expect(await requestProtection()).toBe("unknown");
  });
});

describe("ensureProtectionOnStartup", () => {
  it("case 1: already protected — writes row, does NOT call persist()", async () => {
    const persist = vi.fn();
    setStorageApi({ persisted: async () => true, persist });
    const state = await ensureProtectionOnStartup();
    expect(state).toBe("protected");
    expect(persist).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledWith({ key: "storageProtection", value: "protected" });
  });

  it("case 2: best_effort + no prior attempt — calls persist() once, flag written first", async () => {
    const persist = vi.fn().mockImplementation(async () => {
      callOrder.push("persist()");
      return true;
    });
    setStorageApi({ persisted: async () => false, persist });

    const state = await ensureProtectionOnStartup();
    expect(state).toBe("protected");

    // Flag must be written before persist() fires
    const flagIdx = callOrder.indexOf("put:storagePersistAttempted");
    const persistIdx = callOrder.indexOf("persist()");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    expect(flagIdx).toBeLessThan(persistIdx);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith({ key: "storageProtection", value: "protected" });
  });

  it("case 3: best_effort + attempted flag already set — persist() NOT called", async () => {
    const persist = vi.fn();
    setStorageApi({ persisted: async () => false, persist });
    // Pre-seed the attempted flag
    mockSettingsStore["storagePersistAttempted"] = true;

    const state = await ensureProtectionOnStartup();
    expect(state).toBe("best_effort");
    expect(persist).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledWith({ key: "storageProtection", value: "best_effort" });
  });

  it("case 4: navigator.storage absent — returns 'unknown', no DB errors", async () => {
    removeStorageApi();
    const state = await ensureProtectionOnStartup();
    expect(state).toBe("unknown");
    // The function may record the unknown state for diagnostics — that's acceptable.
    // What matters is no error is thrown and the return value is correct.
  });

  it("case 5: persisted() throws — resolves 'unknown', startup not blocked", async () => {
    setStorageApi({
      persisted: async () => {
        throw new Error("api error");
      },
    });
    await expect(ensureProtectionOnStartup()).resolves.toBe("unknown");
  });

  it("case 6: persist() never resolves — resolves 'unknown' within timeout window", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
    setStorageApi({ persisted: async () => false, persist });

    const resultPromise = ensureProtectionOnStartup();
    // Advance past the 5 s timeout guard
    await vi.advanceTimersByTimeAsync(6000);
    const state = await resultPromise;
    expect(state).toBe("unknown");
    vi.useRealTimers();
  });
});
