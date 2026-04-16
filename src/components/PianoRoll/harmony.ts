import { SCALES } from "../../audio/BassEngine";
import {
  type PianoRollNote,
  type SoundTarget,
  getScaleNotes,
  chordFromDegree,
  uid,
} from "./types";

export type HarmonyType =
  | "fix-to-scale"
  | "scale-up"
  | "scale-down"
  | "chords-I-IV-V-I"
  | "chords-I-vi-IV-V"
  | "chords-ii-V-I"
  | "chords-I-V-vi-IV"
  | "harmonize-3rds"
  | "harmonize-5ths"
  | "arpeggio-up"
  | "arpeggio-down";

export const HARMONY_PRESETS: { id: HarmonyType; label: string; group: string }[] = [
  { id: "fix-to-scale", label: "⟳ Fix to Scale", group: "Correct" },
  { id: "scale-up", label: "Scale ↑", group: "Scales" },
  { id: "scale-down", label: "Scale ↓", group: "Scales" },
  { id: "chords-I-IV-V-I", label: "I – IV – V – I", group: "Chords" },
  { id: "chords-I-vi-IV-V", label: "I – vi – IV – V", group: "Chords" },
  { id: "chords-ii-V-I", label: "ii – V – I", group: "Chords" },
  { id: "chords-I-V-vi-IV", label: "I – V – vi – IV", group: "Chords" },
  { id: "harmonize-3rds", label: "+ 3rds", group: "Harmonize" },
  { id: "harmonize-5ths", label: "+ 5ths", group: "Harmonize" },
  { id: "arpeggio-up", label: "Arpeggio ↑", group: "Arpeggios" },
  { id: "arpeggio-down", label: "Arpeggio ↓", group: "Arpeggios" },
];

export function generateHarmony(
  type: HarmonyType,
  rootMidi: number,
  scaleName: string,
  startBeat: number,
  gridRes: number,
  track: SoundTarget = "melody",
): PianoRollNote[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const baseOctave = Math.floor(rootMidi / 12);
  const notes: PianoRollNote[] = [];

  const addNote = (midi: number, start: number, dur: number, vel = 0.8) => {
    notes.push({ id: uid(), midi, start, duration: dur, velocity: vel, track });
  };

  switch (type) {
    case "scale-up": {
      const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave, baseOctave + 1);
      scaleNotes.forEach((n, i) =>
        addNote(n, startBeat + i * gridRes * 2, gridRes * 2, 0.7 + (i / scaleNotes.length) * 0.3),
      );
      break;
    }
    case "scale-down": {
      const scaleNotes = getScaleNotes(rootMidi, scaleName, baseOctave, baseOctave + 1).reverse();
      scaleNotes.forEach((n, i) =>
        addNote(n, startBeat + i * gridRes * 2, gridRes * 2, 0.7 + (i / scaleNotes.length) * 0.3),
      );
      break;
    }
    case "chords-I-IV-V-I":
    case "chords-I-vi-IV-V":
    case "chords-ii-V-I":
    case "chords-I-V-vi-IV": {
      const degreeSequences: Record<string, number[]> = {
        "chords-I-IV-V-I": [0, 3, 4, 0],
        "chords-I-vi-IV-V": [0, 5, 3, 4],
        "chords-ii-V-I": [1, 4, 0, 0],
        "chords-I-V-vi-IV": [0, 4, 5, 3],
      };
      const degrees = degreeSequences[type] ?? [0, 3, 4, 0];
      const barDur = 4;
      degrees.forEach((deg, barIdx) => {
        const intervals = chordFromDegree(scaleName, deg);
        const beatOffset = startBeat + barIdx * barDur;
        intervals.forEach((interval) => {
          const midi = rootMidi + interval;
          addNote(midi, beatOffset, barDur - 0.25, 0.75);
        });
      });
      break;
    }
    case "harmonize-3rds":
    case "harmonize-5ths":
      break;
    case "arpeggio-up": {
      const chordNotes = [0, 2, 4].map((d) => (scale[d % scale.length] ?? 0) + rootMidi);
      for (let bar = 0; bar < 4; bar++) {
        const oct = bar < 2 ? 0 : 12;
        chordNotes.forEach((n, i) => {
          addNote(n + oct, startBeat + bar * 4 + i * gridRes * 2, gridRes * 2, 0.7);
          addNote(n + oct + 12, startBeat + bar * 4 + (i + 3) * gridRes * 2, gridRes * 2, 0.6);
        });
      }
      break;
    }
    case "arpeggio-down": {
      const chordNotes = [0, 2, 4]
        .map((d) => (scale[d % scale.length] ?? 0) + rootMidi + 12)
        .reverse();
      for (let bar = 0; bar < 4; bar++) {
        chordNotes.forEach((n, i) => {
          addNote(n, startBeat + bar * 4 + i * gridRes * 2, gridRes * 2, 0.7);
          addNote(n - 12, startBeat + bar * 4 + (i + 3) * gridRes * 2, gridRes * 2, 0.6);
        });
      }
      break;
    }
  }
  return notes;
}

export function harmonizeNotes(
  existingNotes: PianoRollNote[],
  interval: number,
  rootMidi: number,
  scaleName: string,
): PianoRollNote[] {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;
  const result: PianoRollNote[] = [];
  for (const note of existingNotes) {
    const degree = (note.midi - rootMidi + 120) % 12;
    const scaleIdx = scale.indexOf(degree);
    if (scaleIdx < 0) continue;
    const targetDegree = scale[(scaleIdx + interval) % scale.length] ?? 0;
    let targetMidi = note.midi - degree + targetDegree;
    if (targetMidi <= note.midi) targetMidi += 12;
    result.push({
      id: uid(),
      midi: targetMidi,
      start: note.start,
      duration: note.duration,
      velocity: note.velocity * 0.85,
      track: note.track,
    });
  }
  return result;
}
