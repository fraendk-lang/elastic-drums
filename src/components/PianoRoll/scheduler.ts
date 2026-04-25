import { useDrumStore, drumCurrentStepStore, getDrumCurrentStep, getDrumCurrentStepAudioTime } from "../../store/drumStore";
import { audioEngine } from "../../audio/AudioEngine";
import { bassEngine } from "../../audio/BassEngine";
import { chordsEngine } from "../../audio/ChordsEngine";
import { melodyEngine } from "../../audio/MelodyEngine";
import { soundFontEngine } from "../../audio/SoundFontEngine";
import type { PianoRollNote, LoopRange } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   PERSISTENT PIANO ROLL STATE — survives component unmount
   ═════════════════════════════════════════════════════════════════════════ */

let _pianoRollNotes: PianoRollNote[] = [];
let _pianoRollEnabled = true;
let _loopRange: LoopRange = { start: 0, end: 16, enabled: false };

let _lastPlaybackStep = -1;
let _pianoRollStepCounter = 0;
const _activePlaybackNotes = new Set<string>();
const _noteReleaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Current piano-roll-internal step position, independent of drum pattern length.
 *  Used by the UI to render a playhead that traverses the full piano-roll length
 *  even when the underlying drum pattern is only 1 bar and loops. */
export function getPianoRollCurrentStep(): number {
  if (_pianoRollNotes.length === 0) return 0;
  const drumPatternLen = useDrumStore.getState().pattern.length;
  const defaultLen = Math.max(64, drumPatternLen);
  const pianoRollLen = _loopRange.enabled
    ? Math.max(1, Math.round((_loopRange.end - _loopRange.start) * 4))
    : defaultLen;
  const wrapped = _pianoRollStepCounter % pianoRollLen;
  const loopOffset = _loopRange.enabled ? Math.round(_loopRange.start * 4) : 0;
  return loopOffset + wrapped;
}

export function setPianoRollNotes(notes: PianoRollNote[]): void {
  _pianoRollNotes = notes;
}

export function setPianoRollLoop(loop: LoopRange): void {
  const changed = _loopRange.start !== loop.start || _loopRange.end !== loop.end || _loopRange.enabled !== loop.enabled;
  _loopRange = loop;
  // Reset step counter on loop range change to avoid stale offset
  if (changed) {
    releaseAllActiveNotes();
    _pianoRollStepCounter = 0;
    _lastPlaybackStep = -1;
  }
}

export function setPianoRollEnabled(enabled: boolean): void {
  _pianoRollEnabled = enabled;
}

function releaseAllActiveNotes(): void {
  if (_activePlaybackNotes.size === 0) return;
  const now = audioEngine.currentTime + 0.005;
  bassEngine.releaseNote(now);
  chordsEngine.releaseChord(now);
  // Only release melodyEngine when it is the active audio path.
  // When soundFontEngine handles melody the step-sequencer still owns
  // melodyEngine, so we must not cancel its scheduled releases.
  if (!soundFontEngine.isLoaded("melody")) {
    melodyEngine.releaseNote(now);
  }
  _activePlaybackNotes.clear();
  for (const timer of _noteReleaseTimers.values()) clearTimeout(timer);
  _noteReleaseTimers.clear();
}

function pianoRollTick(currentStep: number, bpm: number): void {
  if (!_pianoRollEnabled || _pianoRollNotes.length === 0) return;
  if (currentStep === _lastPlaybackStep) return;

  const drumStepAdvanced = _lastPlaybackStep >= 0;
  _lastPlaybackStep = currentStep;

  if (drumStepAdvanced) {
    _pianoRollStepCounter++;
  } else {
    _pianoRollStepCounter = 0;
  }

  const drumPatternLen = useDrumStore.getState().pattern.length;
  // Piano Roll default length: 4 bars (64 steps)
  const defaultLen = Math.max(64, drumPatternLen);

  // If loop is enabled, the piano roll loops independently over [loopStart, loopEnd).
  // Loop range is in beats → convert to 1/16 steps via *4.
  let pianoRollLen: number;
  let loopOffset = 0; // absolute step where the loop starts
  if (_loopRange.enabled) {
    const loopStartStep = Math.max(0, Math.round(_loopRange.start * 4));
    const loopEndStep = Math.max(loopStartStep + 1, Math.round(_loopRange.end * 4));
    pianoRollLen = loopEndStep - loopStartStep;
    loopOffset = loopStartStep;
  } else {
    pianoRollLen = defaultLen;
  }

  // Detect loop wrap → release hanging notes so bass/chord voices don't stick
  const prevCounter = _pianoRollStepCounter - 1;
  const prevWrapped = prevCounter >= 0 ? prevCounter % pianoRollLen : -1;
  const wrappedStep = _pianoRollStepCounter % pianoRollLen;
  if (wrappedStep < prevWrapped) {
    // wrapped around — cut any active notes
    releaseAllActiveNotes();
  }

  const absoluteStep = loopOffset + wrappedStep;
  // Use the pre-scheduled drum step audio time so piano roll notes are
  // sample-accurate with the drums (same lookahead, no 290ms drift).
  // Fall back to currentTime+0.01 only if the audio time is stale (e.g. first tick).
  const stepAudioTime = getDrumCurrentStepAudioTime();
  const t = stepAudioTime > audioEngine.currentTime ? stepAudioTime : audioEngine.currentTime + 0.01;
  const secPerBeat = 60 / bpm;

  // ─── PHASE 1: Release notes that have ended ─────────────────────
  for (const note of _pianoRollNotes) {
    if (!_activePlaybackNotes.has(note.id)) continue;

    const noteStartStep = Math.round(note.start * 4);
    const noteEndStep = Math.round((note.start + note.duration) * 4);
    const target = note.track;

    const shouldRelease = absoluteStep >= noteEndStep && absoluteStep !== noteStartStep;

    if (shouldRelease) {
      _activePlaybackNotes.delete(note.id);
      const timer = _noteReleaseTimers.get(note.id);
      if (timer) {
        clearTimeout(timer);
        _noteReleaseTimers.delete(note.id);
      }
      if (target === "bass") bassEngine.releaseNote(t);
      else if (target === "chords") chordsEngine.releaseChord(t);
      // Melody: only release monophonic engine when it is the active path.
      else if (target === "melody" && !soundFontEngine.isLoaded("melody")) melodyEngine.releaseNote(t);
    }
  }

  // ─── PHASE 2: Trigger notes that start on this step ─────────────

  // Chord notes must be batched into a single triggerChord() call so all
  // voices of the chord are heard simultaneously. Triggering one note at a
  // time would replace the previous voice on each call, leaving only the
  // last MIDI note audible.
  const chordBatch = _pianoRollNotes.filter(note => {
    if (note.track !== "chords") return false;
    if (_activePlaybackNotes.has(note.id)) return false;
    const s = Math.round(note.start * 4);
    if (s !== absoluteStep) return false;
    if (_loopRange.enabled) {
      const loopStartStep = Math.round(_loopRange.start * 4);
      const loopEndStep   = Math.round(_loopRange.end * 4);
      if (s < loopStartStep || s >= loopEndStep) return false;
    }
    return true;
  });

  if (chordBatch.length > 0) {
    const chordMidis = chordBatch.map(n => n.midi);
    if (soundFontEngine.isLoaded("chords")) {
      // SoundFont handles its own polyphony — play each note individually
      chordBatch.forEach(note => {
        const durSec = note.duration * secPerBeat;
        soundFontEngine.playNote("chords", note.midi, t, note.velocity, durSec);
      });
    } else {
      // Synth chord engine: one call with all MIDI notes at once
      chordsEngine.triggerChord(chordMidis, t, false, false);
    }

    // Mark all chord notes active + individual safety-net timers
    chordBatch.forEach(note => {
      _activePlaybackNotes.add(note.id);
      const durSec = note.duration * secPerBeat;
      const prevTimer = _noteReleaseTimers.get(note.id);
      if (prevTimer) clearTimeout(prevTimer);
      const safetyMs = durSec * 1000 + 80;
      const timer = setTimeout(() => {
        _noteReleaseTimers.delete(note.id);
        if (!_activePlaybackNotes.has(note.id)) return;
        _activePlaybackNotes.delete(note.id);
        // Only release the chord engine once the last chord note expires
        const anyChordActive = _pianoRollNotes.some(
          n => n.track === "chords" && _activePlaybackNotes.has(n.id)
        );
        if (!anyChordActive) chordsEngine.releaseChord(audioEngine.currentTime);
      }, safetyMs);
      _noteReleaseTimers.set(note.id, timer);
    });
  }

  for (const note of _pianoRollNotes) {
    const noteStartStep = Math.round(note.start * 4);
    const target = note.track;

    if (noteStartStep !== absoluteStep || _activePlaybackNotes.has(note.id)) continue;

    // Skip notes outside active loop range
    if (_loopRange.enabled) {
      const loopStartStep = Math.round(_loopRange.start * 4);
      const loopEndStep = Math.round(_loopRange.end * 4);
      if (noteStartStep < loopStartStep || noteStartStep >= loopEndStep) continue;
    }

    // Chord notes were already handled in the batch above
    if (target === "chords") continue;

    _activePlaybackNotes.add(note.id);
    const durSec = note.duration * secPerBeat;

    const prevTimer = _noteReleaseTimers.get(note.id);
    if (prevTimer) clearTimeout(prevTimer);

    switch (target) {
      case "drums":
        audioEngine.triggerVoice(Math.max(0, Math.min(11, note.midi - 36)));
        break;
      case "bass":
        if (soundFontEngine.isLoaded("bass")) {
          soundFontEngine.playNote("bass", note.midi, t, note.velocity, durSec);
        } else {
          bassEngine.triggerNote(note.midi, t, false, false, false);
        }
        break;
      case "melody":
        if (soundFontEngine.isLoaded("melody")) {
          soundFontEngine.playNote("melody", note.midi, t, note.velocity, durSec);
        } else {
          melodyEngine.triggerNote(note.midi, t, false, false, false);
        }
        break;
    }

    // Safety net: setTimeout fires AFTER note duration
    if (target !== "drums") {
      const safetyMs = durSec * 1000 + 80;
      const timer = setTimeout(() => {
        _noteReleaseTimers.delete(note.id);
        if (!_activePlaybackNotes.has(note.id)) return;
        _activePlaybackNotes.delete(note.id);
        const now = audioEngine.currentTime;
        if (target === "bass") bassEngine.releaseNote(now);
        // Melody safety net: only fire when piano roll owns the engine path.
        else if (target === "melody" && !soundFontEngine.isLoaded("melody")) melodyEngine.releaseNote(now);
      }, safetyMs);
      _noteReleaseTimers.set(note.id, timer);
    }
  }
}

// Subscribe directly to the drum step clock — the authoritative tick source.
// useTransportStore.currentStep is never updated during playback;
// drumCurrentStepStore fires on every setDrumStep() call in the drum scheduler.
let _prevDrumStep = -1;
const _drumStepUnsub = drumCurrentStepStore.subscribe(() => {
  const step = getDrumCurrentStep();
  if (step === _prevDrumStep) return;
  _prevDrumStep = step;

  const { bpm, isPlaying } = useDrumStore.getState();
  if (isPlaying) {
    pianoRollTick(step, bpm);
  } else {
    releaseAllActiveNotes();
    _lastPlaybackStep = -1;
    _pianoRollStepCounter = 0;
    // Reset _prevDrumStep so the FIRST step after transport restart
    // always fires a tick — regardless of which step the transport
    // stopped on. Without this, if the transport restarts on the same
    // step it stopped on, the subscription guard (step === _prevDrumStep)
    // silently drops the tick and the piano roll starts one step late.
    _prevDrumStep = -1;
  }
});

// Clean up subscription if Vite HMR replaces this module
if (import.meta.hot) {
  import.meta.hot.dispose(() => _drumStepUnsub());
}
