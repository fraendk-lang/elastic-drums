// src/components/MelodyLayers/melodyLayerScheduler.ts
//
// Subscribes to drumCurrentStepStore, plays notes via melodyLayerEngines.
// Import once (side-effect import) from MelodyLayers/index.tsx to activate.

import { drumCurrentStepStore, getDrumCurrentStepAudioTime, useDrumStore } from "../../store/drumStore";
import { useMelodyLayerStore } from "../../store/melodyLayerStore";
import { melodyLayerEngines } from "../../audio/melodyLayerEngines";
import { MELODY_PRESETS } from "../../store/melodyStore";

// ─── Per-layer step counters ───────────────────────────────────────────────────
// One counter per layer slot (index 0–3), incremented on every drum tick.
const _stepCounters: [number, number, number, number] = [0, 0, 0, 0];
let _lastDrumStep = -1;

// Track previous barLengths to reset step counters when barLength changes mid-playback
const _prevBarLengths: (1 | 2 | 4 | 8)[] = useMelodyLayerStore
  .getState()
  .layers.map((l) => l.barLength) as (1 | 2 | 4 | 8)[];
// Pad to 4 slots
while (_prevBarLengths.length < 4) _prevBarLengths.push(2);

// ─── Playhead store ────────────────────────────────────────────────────────────
// Emits beat position for the active layer so the piano roll playhead can follow.

const _beatListeners = new Set<() => void>();
let _beatSnapshot = { beat: 0 };

export const melodyLayerBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): { beat: number } {
    return _beatSnapshot;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Apply synth settings to a MelodyEngine.
 * Modulates the preset's native cutoff proportionally:
 *   0.5 = preset native, 0 = 1/4 of native, 1 = 4× native (clamped 100–18000 Hz)
 */
function applyLayerSynth(
  engine: typeof melodyLayerEngines[0],
  presetIndex: number,
  cutoff: number
): void {
  const preset = MELODY_PRESETS[presetIndex];
  if (!preset) return;
  const presetCutoff = (preset.params as { cutoff?: number }).cutoff ?? 2000;
  const scale = cutoff <= 0.5 ? cutoff * 2 : 1 + (cutoff - 0.5) * 6;
  const cutoffHz = Math.max(100, Math.min(18000, presetCutoff * scale));
  engine.setParams({ ...preset.params, cutoff: cutoffHz });
}

/**
 * Return notes that fire at the given step counter for a layer.
 * stepsPerLoop = barLength * 16 (16 sixteenth-notes per bar).
 */
export function layerNotesOnStep(
  notes: { startBeat: number; durationBeats: number; pitch: number; id: string }[],
  stepCounter: number,
  barLength: 1 | 2 | 4 | 8
): typeof notes {
  const stepsPerLoop = barLength * 16;
  const localStep = stepCounter % stepsPerLoop;
  const totalBeats = barLength * 4;
  return notes.filter((n) => {
    if (n.startBeat < 0 || n.startBeat >= totalBeats) return false;
    return Math.round(n.startBeat * 4) % stepsPerLoop === localStep;
  });
}

/**
 * Current beat position (0-based) within the active layer's bar window.
 */
export function layerLocalBeat(stepCounter: number, barLength: 1 | 2 | 4 | 8): number {
  const stepsPerLoop = barLength * 16;
  const localStep = stepCounter % stepsPerLoop;
  return localStep / 4;  // 16th-note steps → beats
}

// ─── Tick ──────────────────────────────────────────────────────────────────────

function tick(currentDrumStep: number, bpm: number): void {
  const state = useMelodyLayerStore.getState();
  if (!state.enabled) return;
  if (currentDrumStep === _lastDrumStep) return;

  const advanced = _lastDrumStep >= 0;
  _lastDrumStep = currentDrumStep;

  const { layers, activeLayerId } = state;
  const anySoloed = layers.some((l) => l.soloed);
  const t = getDrumCurrentStepAudioTime();
  const secPerBeat = 60 / bpm;

  // Update per-layer counters and trigger notes
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    let counter = _stepCounters[i] ?? 0;
    if (advanced) { counter++; _stepCounters[i] = counter; }

    const shouldPlay = !layer.muted && !(anySoloed && !layer.soloed);
    const localStep = counter % (layer.barLength * 16);
    const engine = melodyLayerEngines[i];
    if (!engine) continue;

    // Apply synth at start of each loop
    if (localStep === 0) {
      applyLayerSynth(engine, layer.synth.presetIndex, layer.synth.cutoff);
    }

    if (shouldPlay && layer.notes.length > 0) {
      const hits = layerNotesOnStep(layer.notes, counter, layer.barLength);
      for (const note of hits) {
        const midiNote = Math.max(0, Math.min(127, note.pitch + layer.synth.octaveOffset * 12));
        const durationSec = Math.max(0.05, note.durationBeats * secPerBeat);
        engine.triggerPolyNote(midiNote, t, durationSec);
      }
    }
  }

  // Update playhead for active layer
  const activeIdx = layers.findIndex((l) => l.id === activeLayerId);
  if (activeIdx >= 0) {
    const activeLayer = layers[activeIdx]!;
    const beat = layerLocalBeat(_stepCounters[activeIdx] ?? 0, activeLayer.barLength);
    const nextSnapshot = { beat };
    if (nextSnapshot.beat !== _beatSnapshot.beat) {
      _beatSnapshot = nextSnapshot;
      for (const fn of _beatListeners) fn();
    }
  }
}

// ─── Subscribe to drum step clock ─────────────────────────────────────────────

const _unsubDrum = drumCurrentStepStore.subscribe(() => {
  const currentStep = drumCurrentStepStore.getSnapshot();
  const { isPlaying, bpm } = useDrumStore.getState();
  if (isPlaying) {
    tick(currentStep, bpm);
  } else {
    _lastDrumStep = -1;
    _stepCounters.fill(0);
    _beatSnapshot = { beat: 0 };
    for (const fn of _beatListeners) fn();
  }
});

// Reset step counters when enabled toggles or layers array changes
let _prevEnabled = useMelodyLayerStore.getState().enabled;
let _prevLayerCount = useMelodyLayerStore.getState().layers.length;

const _unsubStore = useMelodyLayerStore.subscribe((state) => {
  if (state.enabled !== _prevEnabled) {
    _prevEnabled = state.enabled;
    _stepCounters.fill(0);
    _lastDrumStep = -1;
  }
  if (state.layers.length !== _prevLayerCount) {
    // Zero the new slot's counter when a layer is added so it starts from the top
    if (state.layers.length > _prevLayerCount) {
      _stepCounters[state.layers.length - 1] = 0;
    }
    _prevLayerCount = state.layers.length;
    // Reset counters for slots beyond the current layer count
    for (let i = state.layers.length; i < 4; i++) _stepCounters[i] = 0;
  }
  // Reset counter for each layer whose barLength changed
  state.layers.forEach((layer, i) => {
    const prev = _prevBarLengths[i];
    if (prev !== undefined && layer.barLength !== prev) {
      _prevBarLengths[i] = layer.barLength;
      _stepCounters[i] = 0;
    } else if (prev === undefined) {
      _prevBarLengths[i] = layer.barLength;
    }
  });
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubDrum();
    _unsubStore();
  });
}
