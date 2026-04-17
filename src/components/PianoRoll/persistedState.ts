/**
 * Shared module-level Piano Roll state.
 *
 * Kept here (not inside index.tsx) so external importers (MIDI import,
 * pattern-load) can seed the notes before the component mounts. The
 * PianoRoll component reads _persistedNotes on first mount via useState.
 */

import { setPianoRollNotes, setPianoRollLoop } from "./scheduler";
import type { PianoRollNote, LoopRange } from "./types";

export let _persistedNotes: PianoRollNote[] = [];
export let _persistedLoop: LoopRange = { start: 0, end: 16, enabled: false };

/** Update persisted notes + push to the background scheduler. */
export function updatePersistedNotes(notes: PianoRollNote[]): void {
  _persistedNotes = notes;
  setPianoRollNotes(notes);
}

/** Update persisted loop + push to the background scheduler. */
export function updatePersistedLoop(loop: LoopRange): void {
  _persistedLoop = loop;
  setPianoRollLoop(loop);
}

/** Replace notes from an external source (e.g. MIDI import).
 *  Also nudges any live-mounted Piano Roll component to re-read via
 *  the `notes-imported` CustomEvent. */
export function importPianoRollNotes(notes: PianoRollNote[]): void {
  updatePersistedNotes(notes);
  window.dispatchEvent(new CustomEvent("piano-roll-notes-imported"));
}
