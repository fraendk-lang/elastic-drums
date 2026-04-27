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

  if (chordsSource === "grid" || notes.length === 0) {
    return;
  }

  if (currentStep === _lastStep) return;

  const advanced = _lastStep >= 0;
  _lastStep = currentStep;

  if (advanced) {
    _stepCounter++;
  } else {
    _stepCounter = 0;
  }

  const totalSteps = Math.round(totalBeats * 4);
  const prevWrapped = (_stepCounter - 1 + totalSteps) % totalSteps;
  const wrappedStep = _stepCounter % totalSteps;

  if (wrappedStep < prevWrapped || wrappedStep === 0) releaseAll();

  _currentBeat = wrappedStep / 4;
  for (const fn of _beatListeners) fn();

  // Use the scheduled audio time for the current step for tight sync with drums
  const t = getDrumCurrentStepAudioTime() + 0.01;
  const secPerBeat = 60 / bpm;

  // Release groups that have ended
  if (_activeGroups.size > 0) {
    for (const n of notes) {
      if (!_activeGroups.has(n.chordGroup)) continue;
      const endStep = Math.round((n.startBeat + n.durationBeats) * 4);
      const startStep = Math.round(n.startBeat * 4) % totalSteps;
      if (wrappedStep >= endStep % totalSteps && wrappedStep !== startStep) {
        _activeGroups.delete(n.chordGroup);
        const timer = _releaseTimers.get(n.chordGroup);
        if (timer) { clearTimeout(timer); _releaseTimers.delete(n.chordGroup); }
        chordsEngine.releaseChord(t);
      }
    }
  }

  // Trigger groups starting this step
  const groupsThisStep = new Map<string, { midis: number[]; maxDur: number }>();
  for (const n of notes) {
    const startStep = Math.round(n.startBeat * 4) % totalSteps;
    if (startStep !== wrappedStep) continue;
    if (_activeGroups.has(n.chordGroup)) continue;
    const entry = groupsThisStep.get(n.chordGroup) ?? { midis: [], maxDur: 0 };
    entry.midis.push(n.pitch);
    entry.maxDur = Math.max(entry.maxDur, n.durationBeats);
    groupsThisStep.set(n.chordGroup, entry);
  }

  for (const [group, { midis, maxDur }] of groupsThisStep) {
    chordsEngine.triggerChord(midis, t, false, false);
    _activeGroups.add(group);
    const prev = _releaseTimers.get(group);
    if (prev) clearTimeout(prev);
    const safetyMs = maxDur * secPerBeat * 1000 + 80;
    const timer = setTimeout(() => {
      _releaseTimers.delete(group);
      if (!_activeGroups.has(group)) return;
      _activeGroups.delete(group);
      chordsEngine.releaseChord(audioEngine.currentTime);
    }, safetyMs);
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
