/**
 * Auto-Save: Debounced state persistence to IndexedDB
 * Saves current pattern + synth settings whenever state changes.
 */

const AUTO_SAVE_KEY = "elastic-drums-autosave";
const DEBOUNCE_MS = 2000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface AutoSaveData {
  drumPattern: unknown;
  bpm: number;
  swing: number;
  bassState: unknown;
  chordsState: unknown;
  melodyState: unknown;
  timestamp: number;
}

export function scheduleAutoSave(getData: () => AutoSaveData): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = getData();
      openAutoSaveDB().then((db) => {
        const txn = db.transaction("autosave", "readwrite");
        txn.objectStore("autosave").put({ id: AUTO_SAVE_KEY, ...data });
      }).catch((err) => console.warn("Auto-save failed:", err));
    } catch (err) {
      console.warn("Auto-save error:", err);
    }
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
