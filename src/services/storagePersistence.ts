// ─── Storage Persistence Service ──────────────────────────────────────────────
// Requests durable (persistent) storage for the origin so the browser will
// not evict IndexedDB under storage pressure.
//
// Key design decisions:
// - Fail-safe: any error or missing API resolves "unknown", never "protected"
// - At-most-one automatic prompt (storagePersistAttempted flag, set BEFORE
//   calling persist() so a crash or throw doesn't cause a second prompt)
// - 5 s timeout race on persist() calls to guard against hanging WebViews
// - storagePersistAttempted carried over in backup/restore means the automatic
//   attempt is suppressed on a new device; the manual button still works.

import { db } from "../db";

export type StorageProtection = "protected" | "best_effort" | "unknown";

const PERSIST_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Returns the current storage protection state without side effects.
 * Always queries the live navigator.storage API — never trusts a cached row.
 */
export async function getProtectionState(): Promise<StorageProtection> {
  if (!navigator.storage?.persisted) return "unknown";
  try {
    return (await navigator.storage.persisted()) ? "protected" : "best_effort";
  } catch {
    return "unknown";
  }
}

/**
 * Requests durable storage. Safe to call from a user gesture (e.g. button).
 * Firefox will show a permission prompt here; Chrome/Safari decide silently.
 * A 5 s timeout guard resolves "unknown" to handle hanging WebViews.
 */
export async function requestProtection(): Promise<StorageProtection> {
  if (!navigator.storage?.persist) return "unknown";
  try {
    const result = await withTimeout<boolean | "timeout">(
      navigator.storage.persist(),
      PERSIST_TIMEOUT_MS,
      "timeout"
    );
    if (result === "timeout") return "unknown";
    return result ? "protected" : "best_effort";
  } catch {
    return "unknown";
  }
}

/**
 * Called once at startup (fire-and-forget). Behaviour:
 *  - Already protected → record and return immediately.
 *  - Not yet protected and no prior attempt → make ONE automatic attempt
 *    (flag written BEFORE the call to guard against double-prompting).
 *  - Not yet protected and already attempted → record best_effort, return.
 * Wraps everything so a thrown error never blocks startup.
 */
export async function ensureProtectionOnStartup(): Promise<StorageProtection> {
  try {
    let state = await getProtectionState();

    if (state === "protected") {
      await db.settings.put({ key: "storageProtection", value: "protected" });
      return "protected";
    }

    if (state === "best_effort") {
      const attempted = await db.settings.get("storagePersistAttempted");
      if (!attempted?.value) {
        // Set the flag BEFORE the call — guarantees at-most-one prompt
        await db.settings.put({ key: "storagePersistAttempted", value: true });
        state = await requestProtection();
      }
    }

    await db.settings.put({ key: "storageProtection", value: state });
    return state;
  } catch {
    return "unknown";
  }
}
