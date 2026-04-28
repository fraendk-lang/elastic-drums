/**
 * Pattern persistence using IndexedDB
 *
 * Stores user patterns, song arrangements, and kit assignments.
 * Factory presets are always available from the store defaults.
 */

import type { PatternData } from "../store/drumStore";
import type { BassStep, BassParams } from "../audio/BassEngine";

const DB_NAME = "elastic-drums";
const DB_VERSION = 2;
const PATTERNS_STORE = "patterns";
const SONGS_STORE = "songs";
const BASS_PATTERNS_STORE = "bass-patterns";

export interface StoredPattern {
  id: string;          // e.g. "user-001"
  name: string;
  pattern: PatternData;
  createdAt: number;
  updatedAt: number;
}

export interface SongStep {
  patternId: string;   // Reference to stored pattern
  repeats: number;     // How many times to play
}

export interface StoredBassPattern {
  id: string;
  name: string;
  steps: BassStep[];
  length: number;
  params: BassParams;
  rootNote: number;
  rootName: string;
  scaleName: string;
  automationData?: Record<string, Array<number | undefined>>;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSong {
  id: string;
  name: string;
  steps: SongStep[];
  bpm: number;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PATTERNS_STORE)) {
        db.createObjectStore(PATTERNS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        db.createObjectStore(SONGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BASS_PATTERNS_STORE)) {
        db.createObjectStore(BASS_PATTERNS_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Pattern CRUD ────────────────────────────────────────

export async function savePattern(name: string, pattern: PatternData): Promise<StoredPattern> {
  const db = await openDB();
  const now = Date.now();
  const id = `user-${now}`;

  const stored: StoredPattern = {
    id,
    name,
    pattern: structuredClone(pattern),
    createdAt: now,
    updatedAt: now,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PATTERNS_STORE, "readwrite");
    tx.objectStore(PATTERNS_STORE).put(stored);
    tx.oncomplete = () => resolve(stored);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePattern(id: string, pattern: PatternData): Promise<void> {
  const db = await openDB();
  const existing = await getPattern(id);
  if (!existing) return;

  existing.pattern = structuredClone(pattern);
  existing.updatedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PATTERNS_STORE, "readwrite");
    tx.objectStore(PATTERNS_STORE).put(existing);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPattern(id: string): Promise<StoredPattern | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PATTERNS_STORE, "readonly");
    const req = tx.objectStore(PATTERNS_STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredPattern | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listPatterns(): Promise<StoredPattern[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PATTERNS_STORE, "readonly");
    const req = tx.objectStore(PATTERNS_STORE).getAll();
    req.onsuccess = () => {
      const patterns = req.result as StoredPattern[];
      patterns.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(patterns);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deletePattern(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PATTERNS_STORE, "readwrite");
    tx.objectStore(PATTERNS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Song CRUD ───────────────────────────────────────────

export async function saveSong(name: string, steps: SongStep[], bpm: number): Promise<StoredSong> {
  const db = await openDB();
  const now = Date.now();
  const id = `song-${now}`;

  const stored: StoredSong = { id, name, steps, bpm, createdAt: now };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, "readwrite");
    tx.objectStore(SONGS_STORE).put(stored);
    tx.oncomplete = () => resolve(stored);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSongs(): Promise<StoredSong[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, "readonly");
    const req = tx.objectStore(SONGS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredSong[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, "readwrite");
    tx.objectStore(SONGS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Bass Pattern CRUD ──────────────────────────────────

export async function saveBassPattern(
  name: string,
  data: { steps: BassStep[]; length: number; params: BassParams; rootNote: number; rootName: string; scaleName: string; automationData?: Record<string, Array<number | undefined>> },
): Promise<StoredBassPattern> {
  const db = await openDB();
  const now = Date.now();
  const stored: StoredBassPattern = {
    id: `bass-${now}`,
    name,
    steps: structuredClone(data.steps),
    length: data.length,
    params: structuredClone(data.params),
    rootNote: data.rootNote,
    rootName: data.rootName,
    scaleName: data.scaleName,
    automationData: data.automationData ? structuredClone(data.automationData) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BASS_PATTERNS_STORE, "readwrite");
    tx.objectStore(BASS_PATTERNS_STORE).put(stored);
    tx.oncomplete = () => resolve(stored);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBassPatterns(): Promise<StoredBassPattern[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BASS_PATTERNS_STORE, "readonly");
    const req = tx.objectStore(BASS_PATTERNS_STORE).getAll();
    req.onsuccess = () => {
      const patterns = req.result as StoredBassPattern[];
      patterns.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(patterns);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBassPattern(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BASS_PATTERNS_STORE, "readwrite");
    tx.objectStore(BASS_PATTERNS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
