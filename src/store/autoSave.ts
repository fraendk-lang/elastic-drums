/**
 * Auto-Save: Debounced state persistence to IndexedDB
 * Saves current pattern + synth settings whenever state changes.
 */

const AUTO_SAVE_KEY = "elastic-drums-autosave";
const DEBOUNCE_MS = 2000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Saved-session shape. New optional fields are added at the bottom — older
 * snapshots still load because the loader treats them as `undefined` and
 * leaves the corresponding store at its default.
 *
 * NOT persisted (intentionally):
 *  - Live AudioBuffers (resampled / sliced / drag-dropped samples).
 *    Restoring those would need IndexedDB. For now the user has to re-drop
 *    them after a refresh.
 *  - Performance-pad recorded XY-events. These can be many KB per take and
 *    are usually one-off improvisations rather than something to preserve.
 *  - audioClipStore (raw audio drops in the Arrangement timeline). Same
 *    AudioBuffer-can't-serialize problem.
 */
interface AutoSaveData {
  drumPattern: unknown;
  bpm: number;
  swing: number;
  bassState: unknown;
  chordsState: unknown;
  melodyState: unknown;
  timestamp: number;
  /** Bumped when the schema changes — used by the loader to migrate or skip. */
  schemaVersion?: number;
  /** Scene store: Pattern Variations A–D + the 12 extra scene slots, plus
   *  launch-quantize setting and which scene is currently active. */
  scenesState?: unknown;
  /** Arrangement timeline clips, loop region, total bars. */
  arrangementState?: unknown;
  /** Mixer faders, EQ, sends, mute/solo per channel + group buses. */
  mixerState?: unknown;
  /** Performance pad config: chord-set library, target/mode, loop bars,
   *  quantize, scale octaves, glide. Recorded events NOT included. */
  performancePadState?: unknown;
  /** Melody layer states + enabled flag. */
  melodyLayerState?: unknown;
}

/** Bump when the schema shape changes incompatibly. */
const AUTO_SAVE_SCHEMA_VERSION = 2;
export { AUTO_SAVE_SCHEMA_VERSION };

// Use requestIdleCallback when available so saves happen during idle
// periods and never block playback. Falls back to setTimeout on Safari.
const ric: (cb: () => void, opts?: { timeout: number }) => number =
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? (cb, opts) => (window as typeof window & { requestIdleCallback: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number })
        .requestIdleCallback(() => cb(), opts)
    : (cb) => window.setTimeout(cb, 0);

export function scheduleAutoSave(getData: () => AutoSaveData): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Debounce fired → defer the actual I/O to an idle moment (max 5s deadline)
    ric(() => {
      try {
        const data = getData();
        openAutoSaveDB().then((db) => {
          const txn = db.transaction("autosave", "readwrite");
          txn.onerror = () => console.warn("Auto-save transaction error:", txn.error);
          const req = txn.objectStore("autosave").put({ id: AUTO_SAVE_KEY, ...data });
          req.onerror = () => console.warn("Auto-save put error:", req.error);
        }).catch((err) => console.warn("Auto-save failed:", err));
      } catch (err) {
        console.warn("Auto-save error:", err);
      }
    }, { timeout: 5000 });
  }, DEBOUNCE_MS);
}

export async function loadAutoSave(): Promise<AutoSaveData | null> {
  try {
    const db = await openAutoSaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("autosave", "readonly");
      const req = tx.objectStore("autosave").get(AUTO_SAVE_KEY);
      req.onsuccess = () => resolve(req.result as AutoSaveData | null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearAutoSave(): Promise<void> {
  try {
    const db = await openAutoSaveDB();
    const tx = db.transaction("autosave", "readwrite");
    tx.objectStore("autosave").delete(AUTO_SAVE_KEY);
  } catch { /* ignore */ }
}

function openAutoSaveDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("elastic-drums-autosave", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("autosave")) {
        db.createObjectStore("autosave", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
