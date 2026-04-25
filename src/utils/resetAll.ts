/**
 * resetAll — Full session reset across all stores and engines.
 *
 * Clears every sequencer, synth parameter, sample, pad, piano roll note
 * and loop slot — returning the app to a clean blank-slate state.
 */

import { useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useSamplerStore, stopSamplerScheduler } from "../store/samplerStore";
import { useLoopPlayerStore, type LoopSlotState } from "../store/loopPlayerStore";
import { bassEngine, DEFAULT_BASS_PARAMS } from "../audio/BassEngine";
import { chordsEngine, DEFAULT_CHORDS_PARAMS } from "../audio/ChordsEngine";
import { melodyEngine, DEFAULT_MELODY_PARAMS } from "../audio/MelodyEngine";
import { audioEngine } from "../audio/AudioEngine";
import { loopPlayerEngine } from "../audio/LoopPlayerEngine";
import { updatePersistedNotes } from "../components/PianoRoll/persistedState";

function createEmptyLoopSlot(): LoopSlotState {
  return {
    buffer:          null,
    fileName:        "",
    duration:        0,
    originalBpm:     120,
    volume:          0.8,
    playing:         false,
    analyzing:       false,
    detectedBpm:     null,
    firstBeatOffset: 0,
    loopEndSeconds:  0,
  };
}

export function resetAll(): void {
  const now = audioEngine.getAudioContext()?.currentTime;

  // ── 1. Stop all playback ───────────────────────────────────
  const drumStore = useDrumStore.getState();
  if (drumStore.isPlaying) drumStore.togglePlay();

  bassEngine.panic(now);
  chordsEngine.panic(now);
  melodyEngine.panic(now);
  stopSamplerScheduler();
  loopPlayerEngine.stopAll();
  useLoopPlayerStore.getState().stopAll();

  // ── 2. Drums + samples + voice defaults ────────────────────
  // newSession(): clears pattern, all samples, voice params, BPM→120, swing→50
  drumStore.newSession();

  // ── 3. Bass ───────────────────────────────────────────────
  useBassStore.getState().clearSteps();
  useBassStore.setState({
    params: { ...DEFAULT_BASS_PARAMS },
    rootNote: 36,
    rootName: "C",
    scaleName: "Minor",
    length: 16,
  });
  bassEngine.setParams({ ...DEFAULT_BASS_PARAMS });

  // ── 4. Chords ─────────────────────────────────────────────
  useChordsStore.getState().clearSteps();
  useChordsStore.setState({
    params: { ...DEFAULT_CHORDS_PARAMS },
    rootNote: 36,
    rootName: "C",
    scaleName: "Minor",
    length: 16,
  });
  chordsEngine.setParams({ ...DEFAULT_CHORDS_PARAMS });

  // ── 5. Melody ─────────────────────────────────────────────
  useMelodyStore.getState().clearSteps();
  useMelodyStore.setState({
    params: { ...DEFAULT_MELODY_PARAMS },
    rootNote: 36,
    rootName: "C",
    scaleName: "Minor",
    length: 16,
  });
  melodyEngine.setParams({ ...DEFAULT_MELODY_PARAMS });

  // ── 6. Sampler: clear all 16 pads ─────────────────────────
  const samplerState = useSamplerStore.getState();
  for (let i = 0; i < 16; i++) samplerState.clearPad(i);
  useSamplerStore.setState({ selectedPad: 0, patternLength: 16, currentStep: 0 });

  // ── 7. Loop Player: clear all 8 slots ─────────────────────
  useLoopPlayerStore.setState({
    slots: Array.from({ length: 8 }, createEmptyLoopSlot),
  });

  // ── 8. Piano Roll: clear all notes ────────────────────────
  updatePersistedNotes([]);
  window.dispatchEvent(new CustomEvent("piano-roll-notes-imported"));
}
