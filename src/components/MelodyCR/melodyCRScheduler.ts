// src/components/MelodyCR/melodyCRScheduler.ts
//
// Subscribes to drumCurrentStepStore, plays MelodyCR notes via
// callCREngine (= melodyEngine) and responseCREngine.
// Import once (side-effect import) from MelodyCREditor to activate.

import { drumCurrentStepStore, getDrumCurrentStepAudioTime, useDrumStore } from "../../store/drumStore";
import { useMelodyCRStore } from "../../store/melodyCRStore";
import { callCREngine, responseCREngine } from "../../audio/melodyCREngines";
import { MELODY_PRESETS } from "../../store/melodyStore";
import {
  getActiveVoice,
  getLocalStep,
  stepToBeat,
  notesOnStep,
} from "./melodyCRUtils";

// ─── Internal state ────────────────────────────────────────────────────────────

let _lastStep = -1;
let _stepCounter = 0;

// External beat store — drives playhead in MelodyCREditor
const _beatListeners = new Set<() => void>();
let _snapshot: { voice: "call" | "response"; beat: number } = { voice: "call", beat: 0 };

export const melodyCRCurrentBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): { voice: "call" | "response"; beat: number } {
    return _snapshot;
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Apply SynthSettings to a MelodyEngine instance. */
function applySynth(
  engine: typeof callCREngine,
  presetIndex: number,
  cutoff: number
): void {
  const preset = MELODY_PRESETS[presetIndex];
  if (preset) {
    // Map cutoff 0–1 to 200–12000 Hz
    const cutoffHz = 200 + cutoff * 11800;
    engine.setParams({ ...preset.params, cutoff: cutoffHz });
  }
}

// ─── Tick ──────────────────────────────────────────────────────────────────────

function tick(currentStep: number, bpm: number): void {
  const state = useMelodyCRStore.getState();
  if (!state.enabled) return;
  if (currentStep === _lastStep) return;

  const advanced = _lastStep >= 0;
  _lastStep = currentStep;

  if (advanced) {
    _stepCounter++;
  } else {
    _stepCounter = 0;
  }

  const { barLength, callNotes, responseNotes, callSynth, responseSynth } = state;

  const voice = getActiveVoice(_stepCounter, barLength);
  const localStep = getLocalStep(_stepCounter, barLength);
  const localBeat = stepToBeat(localStep);
  const totalBeats = barLength * 4;

  // Update playhead store
  _snapshot = { voice, beat: localBeat };
  for (const fn of _beatListeners) fn();

  // Determine engine + notes + effective synth
  const isCall = voice === "call";
  const engine = isCall ? callCREngine : responseCREngine;
  const notes = isCall ? callNotes : responseNotes;
  // Response can link to Call's synth settings
  const effectiveSynth =
    !isCall && responseSynth.linkToCall ? callSynth : isCall ? callSynth : responseSynth;

  // Apply synth settings at start of each voice section
  if (localStep === 0) {
    applySynth(engine, effectiveSynth.presetIndex, effectiveSynth.cutoff);
  }

  if (notes.length === 0) return;

  const t = getDrumCurrentStepAudioTime();
  const secPerBeat = 60 / bpm;

  const hits = notesOnStep(notes, localStep, totalBeats);
  for (const note of hits) {
    const midiNote = Math.max(0, Math.min(127, note.pitch + effectiveSynth.octaveOffset * 12));
    const durationSec = Math.max(0.05, note.durationBeats * secPerBeat);
    engine.triggerPolyNote(midiNote, t, durationSec);
  }
}

// ─── Subscribe to drum step clock ─────────────────────────────────────────────

const _unsubDrum = drumCurrentStepStore.subscribe(() => {
  const currentStep = drumCurrentStepStore.getSnapshot();
  const { isPlaying, bpm } = useDrumStore.getState();

  if (isPlaying) {
    tick(currentStep, bpm);
  } else {
    _lastStep = -1;
    _stepCounter = 0;
    _snapshot = { voice: "call", beat: 0 };
    for (const fn of _beatListeners) fn();
  }
});

// Reset step counter when barLength or enabled changes mid-playback
let _prevBarLength = useMelodyCRStore.getState().barLength;
let _prevEnabled = useMelodyCRStore.getState().enabled;
const _unsubStore = useMelodyCRStore.subscribe((state) => {
  if (state.barLength !== _prevBarLength) {
    _prevBarLength = state.barLength;
    _stepCounter = 0;
    _lastStep = -1;
  }
  if (state.enabled !== _prevEnabled) {
    _prevEnabled = state.enabled;
    _stepCounter = 0;
    _lastStep = -1;
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubDrum();
    _unsubStore();
  });
}
