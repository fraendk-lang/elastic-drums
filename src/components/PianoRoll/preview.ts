import { audioEngine } from "../../audio/AudioEngine";
import { bassEngine } from "../../audio/BassEngine";
import { chordsEngine } from "../../audio/ChordsEngine";
import { melodyEngine } from "../../audio/MelodyEngine";
import { soundFontEngine } from "../../audio/SoundFontEngine";
import type { SoundTarget } from "./types";

/**
 * Preview a note with a guaranteed release safety-net.
 * Used for click-to-audition, piano-key clicks, and drag-pitch-change feedback.
 */
let _previewReleaseTimer: ReturnType<typeof setTimeout> | null = null;

export function previewNote(midi: number, velocity: number, target: SoundTarget): void {
  const now = audioEngine.currentTime;

  if (_previewReleaseTimer) clearTimeout(_previewReleaseTimer);

  switch (target) {
    case "drums":
      audioEngine.triggerVoice(Math.max(0, Math.min(11, midi - 36)));
      return;
    case "bass":
      if (soundFontEngine.isLoaded("bass")) {
        soundFontEngine.playNote("bass", midi, now, velocity, 0.25);
        return;
      }
      bassEngine.triggerNote(midi, now, false, false, false);
      break;
    case "chords":
      if (soundFontEngine.isLoaded("chords")) {
        soundFontEngine.playNote("chords", midi, now, velocity, 0.25);
        return;
      }
      chordsEngine.triggerChord([midi], now, false, false);
      break;
    case "melody":
      if (soundFontEngine.isLoaded("melody")) {
        soundFontEngine.playNote("melody", midi, now, velocity, 0.25);
        return;
      }
      melodyEngine.triggerNote(midi, now, false, false, false);
      break;
  }

  // Safety net: guaranteed release after 300ms
  _previewReleaseTimer = setTimeout(() => {
    _previewReleaseTimer = null;
    const t = audioEngine.currentTime;
    if (target === "bass") bassEngine.releaseNote(t);
    else if (target === "chords") chordsEngine.releaseChord(t);
    else if (target === "melody") melodyEngine.releaseNote(t);
  }, 300);
}
