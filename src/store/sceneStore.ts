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
}

interface SceneStore {
  scenes: (Scene | null)[]; // 16 slots
  activeScene: number; // -1 = no scene active
  nextScene: number | null; // Queued scene (switches on next bar)

  // Actions
  captureScene: (slot: number) => void;
  loadScene: (slot: number) => void;
  queueScene: (slot: number) => void;
  clearScene: (slot: number) => void;
  renameScene: (slot: number, name: string) => void;
}

// ─── Helpers ────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
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
      rootNote: bass.rootNote,
      rootName: bass.rootName,
      scaleName: bass.scaleName,
    };

    // Preserve existing name if slot already has a scene
    const existing = get().scenes[slot];
    if (existing) {
      scene.name = existing.name;
    }

    const newScenes = [...get().scenes];
    newScenes[slot] = scene;
    set({ scenes: newScenes });
  },

  loadScene: (slot: number) => {
    const scene = get().scenes[slot];
    if (!scene) return;

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
    };
    if (scene.melodyParams) {
      melodyUpdate.params = deepClone(scene.melodyParams);
      melodyEngine.setParams(scene.melodyParams);
    }
    useMelodyStore.setState(melodyUpdate);

    // Restore global key/scale — sync across all synths via bassStore
    if (scene.rootNote !== undefined && scene.rootName && scene.scaleName) {
      // Use bass store's setRootNote/setScale which auto-syncs to chords + melody
      useBassStore.getState().setRootNote(scene.rootNote, scene.rootName);
      useBassStore.getState().setScale(scene.scaleName);
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
}));
