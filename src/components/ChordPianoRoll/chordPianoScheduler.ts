// src/components/ChordPianoRoll/chordPianoScheduler.ts
//
// Module-level scheduler: subscribes to drumCurrentStepStore, plays ChordPianoRoll
// notes through chordsEngine. Import once (from the overlay component) to activate.

import { drumCurrentStepStore, getDrumCurrentStepAudioTime } from "../../store/drumStore";
import { useDrumStore } from "../../store/drumStore";
import { useChordPianoStore } from "../../store/chordPianoStore";
import { chordsEngine } from "../../audio/ChordsEngine";
import { audioEngine } from "../../audio/AudioEngine";

// ─── Internal state ──────────────────────────────────────────────────────────

let _lastStep = -1;
let _stepCounter = 0;
const _activeGroups = new Set<string>();
const _releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

// External store for playhead display
const _beatListeners = new Set<() => void>();
let _currentBeat = 0;

export const chordPianoCurrentBeatStore = {
  subscribe(listener: () => void): () => void {
    _beatListeners.add(listener);
    return () => _beatListeners.delete(listener);
  },
  getSnapshot(): number {
    return _currentBeat;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function releaseAll(): void {
  if (_activeGroups.size === 0) return;
  chordsEngine.releaseChord(audioEngine.currentTime + 0.005);
  _activeGroups.clear();
  for (const t of _releaseTimers.values()) clearTimeout(t);
  _releaseTimers.clear();
}

// ─── Tick ────────────────────────────────────────────────────────────────────

function tick(currentStep: number, bpm: number): void {
  const { notes, chordsSource, totalBeats } = useChordPianoStore.getState();

  if (chordsSource === "grid" || notes.length === 0) return;
  if (currentStep === _lastStep) return;

  const advanced = _lastStep >= 0;
  _lastStep = currentStep;

  if (advanced) {
    _stepCounter++;
  } else {
    _stepCounter = 0;
  }

  const totalSteps = Math.round(totalBeats * 4);
  const wrappedStep = _stepCounter % totalSteps;

  // Loop wrap: cut any still-active notes so they don't bleed into the next cycle.
  // Only on actual wrap (advanced=true), not on the very first tick (_stepCounter=0).
  if (wrappedStep === 0 && advanced) releaseAll();

  _currentBeat = wrappedStep / 4;
  for (const fn of _beatListeners) fn();

  // The drum lookahead scheduler already sets this to a future audio timestamp
  // (scheduled 0–300 ms ahead). Use it directly — no offset needed.
  const t = getDrumCurrentStepAudioTime();
  const secPerBeat = 60 / bpm;

  // Collect notes that start on this step, grouped by chordGroup.
  const groupsThisStep = new Map<string, { midis: number[]; durBeats: number }>();
  for (const n of notes) {
    const startStep = Math.round(n.startBeat * 4) % totalSteps;
    if (startStep !== wrappedStep) continue;
    const entry = groupsThisStep.get(n.chordGroup) ?? { midis: [], durBeats: 0 };
    entry.midis.push(n.pitch);
    entry.durBeats = Math.max(entry.durBeats, n.durationBeats);
    groupsThisStep.set(n.chordGroup, entry);
  }

  for (const [group, { midis, durBeats }] of groupsThisStep) {
    // Cancel any pending safety-net timer from a previous trigger of this group
    const prev = _releaseTimers.get(group);
    if (prev) clearTimeout(prev);

    const releaseSec = durBeats * secPerBeat;
    const releaseAt = t + releaseSec;

    // Trigger + pre-schedule release via Web Audio API — tight and exact.
    // This is the same pattern used by chordsStore.ts (lookahead scheduling).
    chordsEngine.triggerChord(midis, t, false, false);
    chordsEngine.releaseChord(releaseAt);

    _activeGroups.add(group);

    // Safety-net timer: only clears JS tracking state.
    // The actual audio release is already scheduled above via Web Audio API.
    const timer = setTimeout(() => {
      _releaseTimers.delete(group);
      _activeGroups.delete(group);
    }, releaseSec * 1000 + 250);
    _releaseTimers.set(group, timer);
  }
}

// ─── Subscribe to drum step clock ────────────────────────────────────────────

// drumCurrentStepStore is the external store for drum step (useSyncExternalStore pattern).
// Subscribe to it so we fire on every new step without causing React re-renders.
const _unsubDrum = drumCurrentStepStore.subscribe(() => {
  const currentStep = drumCurrentStepStore.getSnapshot();
  const { isPlaying, bpm } = useDrumStore.getState();

  if (isPlaying) {
    tick(currentStep, bpm);
  } else {
    releaseAll();
    _lastStep = -1;
    _stepCounter = 0;
    _currentBeat = 0;
    for (const fn of _beatListeners) fn();
  }
});

// Reset active notes when totalBeats changes mid-playback
let _prevTotalBeats = useChordPianoStore.getState().totalBeats;
const _unsubBeats = useChordPianoStore.subscribe((state) => {
  if (state.totalBeats !== _prevTotalBeats) {
    _prevTotalBeats = state.totalBeats;
    releaseAll();
    _stepCounter = 0;
    _lastStep = -1;
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubDrum();
    _unsubBeats();
  });
}
