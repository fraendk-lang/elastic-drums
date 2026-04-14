/**
 * Custom Kit Store
 *
 * Manages user-created drum kits (voice sample assignments).
 * Persists to IndexedDB for recall.
 */

import { create } from "zustand";

const DB_NAME = "elastic-drums";
const DB_VERSION = 3;
const KITS_STORE = "custom-kits";

export interface CustomKit {
  id: string;
  name: string;
  voices: (string | null)[]; // 12 entries: sample ID or null (= use VA synth)
  createdAt: number;
  updatedAt: number;
}

interface CustomKitState {
  kits: CustomKit[];
  activeKitId: string | null;
  voiceSamples: (string | null)[]; // Current assignments (sample IDs per voice)

  // Actions
  saveCurrentKit: (name: string) => Promise<CustomKit>;
  loadKit: (id: string) => Promise<void>;
  deleteKit: (id: string) => Promise<void>;
  listKits: () => Promise<void>;
  setVoiceSample: (voice: number, sampleId: string | null) => void;
  clearAllSamples: () => void;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KITS_STORE)) {
        db.createObjectStore(KITS_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const useCustomKitStore = create<CustomKitState>((set, get) => ({
  kits: [],
  activeKitId: null,
  voiceSamples: Array(12).fill(null),

  setVoiceSample: (voice: number, sampleId: string | null) => {
    set(state => {
      const next = [...state.voiceSamples];
      next[voice] = sampleId;
      return { voiceSamples: next };
    });
  },

  clearAllSamples: () => {
    set({ voiceSamples: Array(12).fill(null) });
  },

  saveCurrentKit: async (name: string) => {
    const db = await openDB();
    const now = Date.now();
    const id = `kit-${now}`;
    const state = get();

    const kit: CustomKit = {
      id,
      name,
      voices: [...state.voiceSamples],
      createdAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(KITS_STORE, "readwrite");
      tx.objectStore(KITS_STORE).put(kit);
      tx.oncomplete = () => {
        set(s => ({
          kits: [...s.kits, kit],
          activeKitId: id,
        }));
        resolve(kit);
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  loadKit: async (id: string) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KITS_STORE, "readonly");
      const req = tx.objectStore(KITS_STORE).get(id);

      req.onsuccess = () => {
        const kit = req.result as CustomKit | undefined;
        if (kit) {
          set({
            voiceSamples: [...kit.voices],
            activeKitId: id,
          });
          resolve();
        } else {
          reject(new Error(`Kit not found: ${id}`));
        }
      };

      req.onerror = () => reject(req.error);
    });
  },

  deleteKit: async (id: string) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KITS_STORE, "readwrite");
      tx.objectStore(KITS_STORE).delete(id);

      tx.oncomplete = () => {
        set(s => ({
          kits: s.kits.filter(k => k.id !== id),
          activeKitId: s.activeKitId === id ? null : s.activeKitId,
        }));
        resolve();
      };

      tx.onerror = () => reject(tx.error);
    });
  },

  listKits: async () => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KITS_STORE, "readonly");
      const req = tx.objectStore(KITS_STORE).getAll();

      req.onsuccess = () => {
        const kits = (req.result as CustomKit[]).sort(
          (a, b) => b.createdAt - a.createdAt
        );
        set({ kits });
        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  },
}));
