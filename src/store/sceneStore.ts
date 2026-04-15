/**
 * Scene Launcher Store
 *
 * A Scene = snapshot of all 4 sequencers (drum pattern + bass + chords + melody steps).
 * Up to 16 scenes. Users can switch live (quantized to next bar via queueScene).
 */

import { create } from "zustand";
import { useDrumStore, type PatternData } from "./drumStore";
import { useBassStore } from "./bassStore";
import { useChordsStore } from "./chordsStore";
import { useMelodyStore } from "./melodyStore";
import { bassEngine, type BassStep, type BassParams } from "../audio/BassEngine";
import { chordsEngine, type ChordsStep, type ChordsParams } from "../audio/ChordsEngine";
import { melodyEngine, type MelodyStep, type MelodyParams } from "../audio/MelodyEngine";
import { audioEngine } from "../audio/AudioEngine";
import { soundFontEngine } from "../audio/SoundFontEngine";
import { ROOT_NOTES } from "../audio/BassEngine";

// ─── Types ──────────────────────────────────────────────

export interface Scene {
  name: string;
  drumPattern: PatternData; // Full drum pattern snapshot
  bassSteps: BassStep[];
  bassLength: number;
  bassParams?: BassParams;     // Synth parameters (cutoff, resonance, etc.)
  chordsSteps: ChordsStep[];
  chordsLength: number;
  chordsParams?: ChordsParams; // Synth parameters
  melodySteps: MelodyStep[];
  melodyLength: number;
  melodyParams?: MelodyParams; // Synth parameters
  // Drum voice params per track
  drumVoiceParams?: Record<string, number>[]; // 12 tracks × param map
  // Global key/scale for this scene
  rootNote?: number;   // MIDI note (bass octave, e.g. 36=C2)
  rootName?: string;   // "C", "D#", etc.
  scaleName?: string;  // "Minor", "Dorian", etc.
  bassGlobalOctave?: number;
  chordsGlobalOctave?: number;
  melodyGlobalOctave?: number;
}

interface SceneStore {
  scenes: (Scene | null)[]; // 16 slots
  activeScene: number; // -1 = no scene active
  nextScene: number | null; // Queued scene (switches on next bar)

  // Actions
  captureScene: (slot: number) => void;
  updateScene: (slot: number) => void; // Re-capture into existing slot, preserving name
  loadScene: (slot: number) => void;
  queueScene: (slot: number) => void;
  clearScene: (slot: number) => void;
  renameScene: (slot: number, name: string) => void;
  duplicateScene: (fromSlot: number, toSlot?: number) => void;
  swapScenes: (a: number, b: number) => void;
}

// ─── Helpers ────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeBassRootMidi(rootName?: string, fallbackMidi?: number): number | undefined {
  if (rootName) {
    const rootIndex = ROOT_NOTES.indexOf(rootName);
    if (rootIndex >= 0) return 36 + rootIndex;
  }
  if (fallbackMidi !== undefined) {
    return 36 + (((fallbackMidi % 12) + 12) % 12);
  }
  return undefined;
}

// ─── Store ──────────────────────────────────────────────

export const useSceneStore = create<SceneStore>((set, get) => ({
  scenes: new Array<Scene | null>(16).fill(null),
  activeScene: -1,
  nextScene: null,

  captureScene: (slot: number) => {
    if (slot < 0 || slot > 15) return;

    const drum = useDrumStore.getState();
    const bass = useBassStore.getState();
    const chords = useChordsStore.getState();
    const melody = useMelodyStore.getState();
    const liveScaleState = {
      bass: {
        rootNote: bass.rootNote,
        rootName: bass.rootName,
        scaleName: bass.scaleName,
        globalOctave: bass.globalOctave,
      },
      chords: {
        rootNote: chords.rootNote,
        rootName: chords.rootName,
        scaleName: chords.scaleName,
        globalOctave: chords.globalOctave,
      },
      melody: {
        rootNote: melody.rootNote,
        rootName: melody.rootName,
        scaleName: melody.scaleName,
        globalOctave: melody.globalOctave,
      },
    };

    // Capture drum voice params from AudioEngine
    const drumVoiceParams: Record<string, number>[] = [];
    for (let i = 0; i < 12; i++) {
      drumVoiceParams.push(deepClone(audioEngine.getVoiceParams(i)));
    }

    const scene: Scene = {
      name: `Scene ${slot + 1}`,
      drumPattern: deepClone(drum.pattern),
      bassSteps: deepClone(bass.steps),
      bassLength: bass.length,
      bassParams: deepClone(bass.params),
      chordsSteps: deepClone(chords.steps),
      chordsLength: chords.length,
      chordsParams: deepClone(chords.params),
      melodySteps: deepClone(melody.steps),
      melodyLength: melody.length,
      melodyParams: deepClone(melody.params),
      drumVoiceParams,
      // Save global key/scale (from bass store as reference)
      rootNote: normalizeBassRootMidi(bass.rootName, bass.rootNote),
      rootName: bass.rootName,
      scaleName: bass.scaleName,
      bassGlobalOctave: bass.globalOctave,
      chordsGlobalOctave: chords.globalOctave,
      melodyGlobalOctave: melody.globalOctave,
    };

    // Preserve existing name if slot already has a scene
    const existing = get().scenes[slot];
    if (existing) {
      scene.name = existing.name;
    }

    const newScenes = [...get().scenes];
    newScenes[slot] = scene;
    set({ scenes: newScenes });

    // Capture must be write-only. Some UI flows around scene confirmation can
    // cause follow-up state churn; re-assert the live tuning state so saving a
    // scene never changes the currently playing pitch.
    useBassStore.setState(liveScaleState.bass);
    useChordsStore.setState(liveScaleState.chords);
    useMelodyStore.setState(liveScaleState.melody);
  },

  loadScene: (slot: number) => {
    const scene = get().scenes[slot];
    if (!scene) return;

    // Hard-stop any sustained voices before swapping scene state.
    // Without this, held notes from the previous scene can layer with the next one.
    const now = audioEngine.getAudioContext()?.currentTime;
    bassEngine.panic(now);
    chordsEngine.panic(now);
    melodyEngine.panic(now);
    soundFontEngine.stopAll("bass");
    soundFontEngine.stopAll("chords");
    soundFontEngine.stopAll("melody");

    // Apply drum pattern
    useDrumStore.setState({ pattern: deepClone(scene.drumPattern) });

    // Restore drum voice params
    if (scene.drumVoiceParams) {
      for (let i = 0; i < 12; i++) {
        const params = scene.drumVoiceParams[i];
        if (params) {
          for (const [key, val] of Object.entries(params)) {
            audioEngine.setVoiceParam(i, key, val);
          }
        }
      }
    }

    // Apply bass steps + params
    const bassUpdate: Record<string, unknown> = {
      steps: deepClone(scene.bassSteps),
      length: scene.bassLength,
      globalOctave: scene.bassGlobalOctave ?? 0,
    };
    if (scene.bassParams) {
      bassUpdate.params = deepClone(scene.bassParams);
      bassEngine.setParams(scene.bassParams);
    }
    useBassStore.setState(bassUpdate);

    // Apply chords steps + params
    const chordsUpdate: Record<string, unknown> = {
      steps: deepClone(scene.chordsSteps),
      length: scene.chordsLength,
      globalOctave: scene.chordsGlobalOctave ?? 0,
    };
    if (scene.chordsParams) {
      chordsUpdate.params = deepClone(scene.chordsParams);
      chordsEngine.setParams(scene.chordsParams);
    }
    useChordsStore.setState(chordsUpdate);

    // Apply melody steps + params
    const melodyUpdate: Record<string, unknown> = {
      steps: deepClone(scene.melodySteps),
      length: scene.melodyLength,
      globalOctave: scene.melodyGlobalOctave ?? 0,
    };
    if (scene.melodyParams) {
      melodyUpdate.params = deepClone(scene.melodyParams);
      melodyEngine.setParams(scene.melodyParams);
    }
    useMelodyStore.setState(melodyUpdate);

    // Restore global key/scale — set DIRECTLY on each store to avoid sync ping-pong.
    // The sync mechanism (syncScaleToOtherStores) can cause octave drift when
    // it recalculates rootNote offsets between stores during scene load.
    if (scene.rootName && scene.scaleName) {
      const bassRootMidi = normalizeBassRootMidi(scene.rootName, scene.rootNote) ?? 36;
      const rootIndex = ROOT_NOTES.indexOf(scene.rootName);
      const chordsRootMidi = rootIndex >= 0 ? 48 + rootIndex : 48;
      const melodyRootMidi = chordsRootMidi; // Same octave as chords

      useBassStore.setState({
        rootNote: bassRootMidi,
        rootName: scene.rootName,
        scaleName: scene.scaleName,
      });
      useChordsStore.setState({
        rootNote: chordsRootMidi,
        rootName: scene.rootName,
        scaleName: scene.scaleName,
      });
      useMelodyStore.setState({
        rootNote: melodyRootMidi,
        rootName: scene.rootName,
        scaleName: scene.scaleName,
      });
    }

    set({ activeScene: slot, nextScene: null });
  },

  queueScene: (slot: number) => {
    const scene = get().scenes[slot];
    if (!scene) return;

    // If same scene is already queued, cancel the queue
    if (get().nextScene === slot) {
      set({ nextScene: null });
      return;
    }

    set({ nextScene: slot });
  },

  clearScene: (slot: number) => {
    const newScenes = [...get().scenes];
    newScenes[slot] = null;

    const updates: Partial<SceneStore> = { scenes: newScenes };
    // Reset active/queued if they pointed to this slot
    if (get().activeScene === slot) updates.activeScene = -1;
    if (get().nextScene === slot) updates.nextScene = null;

    set(updates as SceneStore);

    // Clean up song chain references to deleted scene
    const drumState = useDrumStore.getState();
    const cleaned = drumState.songChain.filter(
      (entry) => entry.sceneIndex !== slot,
    );
    if (cleaned.length !== drumState.songChain.length) {
      useDrumStore.setState({ songChain: cleaned });
    }
  },

  renameScene: (slot: number, name: string) => {
    const scene = get().scenes[slot];
    if (!scene) return;

    const newScenes = [...get().scenes];
    newScenes[slot] = { ...scene, name };
    set({ scenes: newScenes });
  },

  // Update scene: re-capture live state into an existing slot, preserving the name.
  // Workflow: Load scene → edit live → Update scene (saves edits back)
  updateScene: (slot: number) => {
    const existing = get().scenes[slot];
    if (!existing) return;
    const savedName = existing.name;
    get().captureScene(slot);
    // Restore the original name (captureScene preserves it, but be explicit)
    const newScenes = [...get().scenes];
    if (newScenes[slot]) {
      newScenes[slot] = { ...newScenes[slot]!, name: savedName };
      set({ scenes: newScenes });
    }
  },

  // Duplicate a scene to the next empty slot (or a specific target slot)
  duplicateScene: (fromSlot: number, toSlot?: number) => {
    const source = get().scenes[fromSlot];
    if (!source) return;

    const scenes = get().scenes;
    let target = toSlot;
    if (target === undefined) {
      // Find next empty slot
      target = scenes.findIndex((s, i) => s === null && i !== fromSlot);
      if (target === -1) return; // No empty slots
    }
    if (target < 0 || target > 15) return;

    const newScenes = [...scenes];
    newScenes[target] = deepClone({ ...source, name: `${source.name} Copy` });
    set({ scenes: newScenes });
  },

  // Swap two scene slots (for reordering)
  swapScenes: (a: number, b: number) => {
    if (a === b || a < 0 || a > 15 || b < 0 || b > 15) return;
    const newScenes = [...get().scenes];
    const temp = newScenes[a] ?? null;
    newScenes[a] = newScenes[b] ?? null;
    newScenes[b] = temp;

    // Update activeScene / nextScene references
    const updates: Partial<SceneStore> = { scenes: newScenes };
    const active = get().activeScene;
    const next = get().nextScene;
    if (active === a) updates.activeScene = b;
    else if (active === b) updates.activeScene = a;
    if (next === a) updates.nextScene = b;
    else if (next === b) updates.nextScene = a;

    set(updates as SceneStore);

    // Update song chain references
    const drumState = useDrumStore.getState();
    const updatedChain = drumState.songChain.map((entry) => {
      if (entry.sceneIndex === a) return { ...entry, sceneIndex: b };
      if (entry.sceneIndex === b) return { ...entry, sceneIndex: a };
      return entry;
    });
    useDrumStore.setState({ songChain: updatedChain });
  },
}));
