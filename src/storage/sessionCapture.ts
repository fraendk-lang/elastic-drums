/**
 * sessionCapture.ts
 *
 * Snapshot and restore all session state (BPM, bass, chords, melody,
 * piano roll, mixer, drum voice params) alongside a stored pattern.
 *
 * captureFullState() — call just before savePattern() / updatePattern()
 * restoreFullState() — call just after loading a StoredPattern from IndexedDB
 */

import { useDrumStore } from "../store/drumStore";
import { useBassStore } from "../store/bassStore";
import { useChordsStore } from "../store/chordsStore";
import { useMelodyStore } from "../store/melodyStore";
import { useMixerBarStore } from "../store/mixerBarStore";
import { audioEngine } from "../audio/AudioEngine";
import {
  _persistedNotes,
  _persistedLoop,
  updatePersistedNotes,
  updatePersistedLoop,
} from "../components/PianoRoll/persistedState";
import type { StoredPattern } from "./patternStorage";

// ─── Capture ────────────────────────────────────────────────────────────────

export function captureFullState(): Omit<StoredPattern, 'id' | 'name' | 'pattern' | 'createdAt' | 'updatedAt'> {
  const drum = useDrumStore.getState();
  const bass = useBassStore.getState();
  const chords = useChordsStore.getState();
  const melody = useMelodyStore.getState();
  const mixer = useMixerBarStore.getState();

  // Voice params from audio engine (12 voices)
  const drumVoiceParams: Record<string, number>[] = [];
  for (let v = 0; v < 12; v++) {
    drumVoiceParams.push(audioEngine.getVoiceParams(v));
  }

  return {
    bpm: drum.bpm,
    schemaVersion: 2,
    drumVoiceParams,
    bass: {
      steps: bass.steps,
      length: bass.length,
      params: bass.params,
      rootNote: bass.rootNote,
      rootName: bass.rootName,
      scaleName: bass.scaleName,
      globalOctave: bass.globalOctave ?? 0,
      automationData: bass.automationData ?? {},
      instrument: bass.instrument ?? "_synth_",
      arp: bass.arp ?? null,
    },
    chords: {
      steps: chords.steps,
      length: chords.length,
      params: chords.params,
      rootNote: chords.rootNote,
      rootName: chords.rootName,
      scaleName: chords.scaleName,
      globalOctave: chords.globalOctave ?? 0,
      automationData: chords.automationData ?? {},
      instrument: chords.instrument ?? "_synth_",
      arp: chords.arp ?? null,
    },
    melody: {
      steps: melody.steps,
      length: melody.length,
      params: melody.params,
      rootNote: melody.rootNote,
      rootName: melody.rootName,
      scaleName: melody.scaleName,
      globalOctave: melody.globalOctave ?? 0,
      automationData: melody.automationData ?? {},
      instrument: melody.instrument ?? "_synth_",
      arp: melody.arp ?? null,
      humanize: melody.humanize ?? null,
      layerMode: melody.layerMode ?? "off",
      layerVelocity: melody.layerVelocity ?? 0.8,
      stepNoteValue: melody.stepNoteValue ?? "1/16",
    },
    pianoRoll: {
      notes: _persistedNotes,
      loop: _persistedLoop,
    },
    mixer: {
      channels: mixer.channels,
      groupBuses: mixer.groupBuses,
    },
  };
}

// ─── Restore ────────────────────────────────────────────────────────────────

export function restoreFullState(stored: StoredPattern): void {
  // BPM
  if (stored.bpm) {
    useDrumStore.getState().setBpm(stored.bpm);
  }

  // Voice params
  if (stored.drumVoiceParams) {
    stored.drumVoiceParams.forEach((params, voice) => {
      Object.entries(params).forEach(([paramId, value]) => {
        audioEngine.setVoiceParam(voice, paramId, value);
      });
    });
  }

  // Bass — use loadBassPattern for core fields, then setState for extras
  if (stored.bass) {
    const b = stored.bass;
    useBassStore.getState().loadBassPattern({
      steps: b.steps as any,
      length: b.length,
      params: b.params as any,
      rootNote: b.rootNote,
      rootName: b.rootName,
      scaleName: b.scaleName,
      automationData: b.automationData,
    });
    // Restore extras not handled by loadBassPattern
    useBassStore.setState({
      ...(b.globalOctave !== undefined ? { globalOctave: b.globalOctave } : {}),
      ...(b.instrument !== undefined ? { instrument: b.instrument } : {}),
      ...(b.arp !== null && b.arp !== undefined ? { arp: b.arp as any } : {}),
    });
  }

  // Chords — same pattern
  if (stored.chords) {
    const c = stored.chords;
    useChordsStore.getState().loadChordsPattern({
      steps: c.steps as any,
      length: c.length,
      params: c.params as any,
      rootNote: c.rootNote,
      rootName: c.rootName,
      scaleName: c.scaleName,
    });
    useChordsStore.setState({
      ...(c.globalOctave !== undefined ? { globalOctave: c.globalOctave } : {}),
      ...(c.instrument !== undefined ? { instrument: c.instrument } : {}),
      ...(c.arp !== null && c.arp !== undefined ? { arp: c.arp as any } : {}),
      ...(c.automationData !== undefined ? { automationData: c.automationData } : {}),
    });
  }

  // Melody — same pattern
  if (stored.melody) {
    const m = stored.melody;
    useMelodyStore.getState().loadMelodyPattern({
      steps: m.steps as any,
      length: m.length,
      params: m.params as any,
      rootNote: m.rootNote,
      rootName: m.rootName,
      scaleName: m.scaleName,
    });
    useMelodyStore.setState({
      ...(m.globalOctave !== undefined ? { globalOctave: m.globalOctave } : {}),
      ...(m.instrument !== undefined ? { instrument: m.instrument } : {}),
      ...(m.arp !== null && m.arp !== undefined ? { arp: m.arp as any } : {}),
      ...(m.automationData !== undefined ? { automationData: m.automationData } : {}),
      ...(m.humanize !== null && m.humanize !== undefined ? { humanize: m.humanize as any } : {}),
      ...(m.layerMode !== undefined ? { layerMode: m.layerMode as any } : {}),
      ...(m.layerVelocity !== undefined ? { layerVelocity: m.layerVelocity } : {}),
      ...(m.stepNoteValue !== undefined ? { stepNoteValue: m.stepNoteValue as any } : {}),
    });
  }

  // Piano roll
  if (stored.pianoRoll) {
    updatePersistedNotes(stored.pianoRoll.notes as any);
    updatePersistedLoop(stored.pianoRoll.loop);
    window.dispatchEvent(new CustomEvent("piano-roll-notes-imported"));
  }

  // Mixer — restore channels array and groupBuses directly via setState
  if (stored.mixer) {
    const update: Partial<ReturnType<typeof useMixerBarStore.getState>> = {};
    if (stored.mixer.channels) {
      update.channels = stored.mixer.channels as any;
    }
    if (stored.mixer.groupBuses) {
      update.groupBuses = stored.mixer.groupBuses as any;
    }
    if (Object.keys(update).length > 0) {
      useMixerBarStore.setState(update as any);
    }
  }
}
