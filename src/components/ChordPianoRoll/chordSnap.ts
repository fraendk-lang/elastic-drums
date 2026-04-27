// src/components/ChordPianoRoll/chordSnap.ts

import { SCALES } from "../../audio/BassEngine";
import { CHORD_SETS, type ChordSetId, type ScaleDegree } from "./chordSets";
import type { ChordNote } from "../../store/chordPianoStore";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"] as const;

/**
 * Find the scale degree and chord-root pitch for a given clicked pitch.
 *
 * Algorithm:
 * 1. Determine which octave the clicked pitch is in relative to rootNote.
 * 2. Find the clicked pitch's semitone within that octave.
 * 3. Find the nearest in-scale semitone (snapping off-scale notes).
 * 4. Return both the degree index (0–scaleLen-1) and the absolute MIDI pitch
 *    of that snapped scale note (= the chord root).
 */
export function pitchToScaleDegreeAndRoot(
  clickedPitch: number,
  rootNote: number,
  scaleName: string,
): { degree: ScaleDegree; chordRootPitch: number } {
  const scale = SCALES[scaleName] ?? SCALES["Chromatic"]!;

  // Semitone of clicked pitch within one octave, relative to root
  const diffFromRoot = clickedPitch - rootNote;
  const octave = Math.floor(diffFromRoot / 12);
  const semitone = ((diffFromRoot % 12) + 12) % 12;

  // Find nearest scale interval
  let bestIdx = 0;
  let bestDist = 13; // > max possible chromatic distance (12), guarantees first iteration always updates
  for (let i = 0; i < scale.length; i++) {
    const interval = scale[i] ?? 0;
    // Wrap-around distance (accounts for distance across the C–B boundary)
    const dist = Math.min(
      Math.abs(interval - semitone),
      12 - Math.abs(interval - semitone),
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  // Clamp to valid ScaleDegree (0–6). For scales with >7 notes (e.g. Chromatic=12,
  // Diminished=8), cap at 6 rather than wrapping — modular wrap would produce
  // incorrect chord-function assignments (e.g. degree 11%7=4 would apply dominant
  // voicing to a leading-tone click).
  const degree = Math.min(bestIdx, 6) as ScaleDegree;
  const chordRootPitch = rootNote + octave * 12 + (scale[bestIdx] ?? 0);
  return { degree, chordRootPitch };
}

/**
 * Given a clicked pitch, produce all ChordNote[] for the chord group.
 * The chord root is the nearest in-scale pitch to the clicked pitch.
 * Voicing offsets are applied from that root upward.
 */
export function chordSnap(
  clickedPitch: number,
  rootNote: number,
  scaleName: string,
  chordSet: ChordSetId,
  startBeat: number,
  durationBeats: number,
  velocity: number,
): ChordNote[] {
  const { degree, chordRootPitch } = pitchToScaleDegreeAndRoot(
    clickedPitch,
    rootNote,
    scaleName,
  );

  const voicings = CHORD_SETS[chordSet].voicings;
  const offsets = voicings[degree] ?? voicings[0 as ScaleDegree] ?? [0];

  const rootName = NOTE_NAMES[chordRootPitch % 12] ?? "?";
  const chordGroup = `${rootName}${chordSet}@${startBeat.toFixed(2)}`;

  const clampedDuration = Math.max(0.25, durationBeats);
  const clampedVelocity = Math.max(0, Math.min(127, velocity));

  return offsets.map((offset) => ({
    id: crypto.randomUUID(),
    pitch: Math.max(0, Math.min(127, chordRootPitch + offset)),
    startBeat,
    durationBeats: clampedDuration,
    velocity: clampedVelocity,
    chordGroup,
  }));
}
